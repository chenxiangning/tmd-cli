/**
 * checkpoints 插件 —— 批次审批/回退(账本模型)。
 *
 * 职责:批次生命周期(锚点/封口时机) + 批次 UI(右栏时间线 + 中央审阅单)。
 * 账本存储/diff/还原全部是后端原语(src-tauri/src/checkpoints);本插件不理解 git 细节。
 * 与 git 插件零耦合:回退直接作用于工作区,不产生任何 git 侧写操作。
 *
 * 账本生命周期 = 工作区 + 会话 + 轮次:
 *   promptSent   → 记第 N 轮锚点(后端隐式先封上一轮,防 turnSettled 丢失)
 *   turnSettled  → 封口:把本窗口变更固化成 turn 条目(文件 + diff 落盘)
 *   sessionExited → 兜底封口,最后一轮落账
 */

import { History } from "lucide-react";
import { host } from "@kernel/host";
import {
  KernelTopics,
  type FileEditEvent,
  type PromptSentEvent,
  type TurnSettledEvent,
} from "@kernel/events";
import { registerFilePanel } from "@kernel/filePanel";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { captureAnchor, recordEdit, sealTurn } from "./store";
import { checkpointIdentity } from "./identity";
import { CheckpointsPanel } from "./CheckpointsPanel";
import { BatchSheetTabContent } from "./BatchSheet";

export const checkpointsPlugin: Plugin = {
  id: "checkpoints",
  meta: {
    name: "批次审批",
    abbr: "CK",
    desc: "AI 改动按轮成批:审 diff、整批或按文件回退",
    icon: History,
    iconColor: "#2FB8AD",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    registerFilePanel({
      id: "checkpoints",
      label: "审批线",
      icon: History,
      component: CheckpointsPanel,
      order: 10,
    });
    ctx.contribute("editorCenter.tabContent", {
      order: 10,
      component: BatchSheetTabContent,
    });

    /** 会话身份解析:统一走 identity.ts 仲裁(cli 身份被多活会话争持时,
     *  先创建者保留、后到者回退 tmd id —— 防绑定竞态把两个会话并进同一条账)。 */
    const identity = (tmdSessionId: string) => {
      const id = checkpointIdentity(tmdSessionId);
      if (!id) return null;
      return { cwd: id.cwd, cliId: id.key, tmdId: id.tmdId };
    };

    /** 锚点随批固化的状态快照:发送时刻的引擎显示名 + 观测的模型/思考强度。
     *  取不到(会话已摘除/CLI 未声明观测)记空串,UI 按段隐藏;宁空勿猜。 */
    const anchorMeta = (tmdSessionId: string) => {
      const session = host.getSessions().find((s) => s.id === tmdSessionId);
      const profile = session ? host.getCliProfile(session.profileId) : undefined;
      const status = host.getSessionStatus(tmdSessionId);
      return {
        engine: profile?.name ?? session?.profileId ?? "",
        model: status?.model ?? "",
        thinking: status?.thinkingLevel ?? "",
      };
    };

    // ---- 会话磁盘事件源(readSessionEdits)--------------------------------
    // editMarks 之外的 events 归因第二信号:从 CLI 自己的会话 JSONL 拉写入
    // 事件(omp)。每会话一个流文件,天然按会话隔离 —— 用户报的"同工作区
    // 并行两会话审批线互相串批"是 git 窗口推断的结构性缺陷(mtime 窗口在
    // 重叠轮次下无法区分写入者),磁盘事件流从根上消除它。

    /** 每会话水位线(tmdSessionId → 已拉取事件最大 ts);首见 = 现在,
     *  防应用重启后全量回放灌入死锚点(封口侧另有 ts 守卫双保险)。 */
    const diskEditWatermark = new Map<string, number>();
    const diskEditInFlight = new Set<string>();

    /** 会话声明了磁盘事件源 → { 身份, 适配器 };否则 null。 */
    const diskEditSource = (tmdSessionId: string) => {
      const session = host.getSessions().find((s) => s.id === tmdSessionId);
      const adapter = session ? host.getCliProfile(session.profileId)?.readSessionEdits : undefined;
      if (!session || !adapter) return null;
      const id = identity(tmdSessionId);
      return id ? { id, adapter } : null;
    };

    /** 拉取本会话增量写入事件并逐条记账。失败保水位线(下次重拉)。 */
    const pullSessionEdits = async (tmdSessionId: string): Promise<void> => {
      const source = diskEditSource(tmdSessionId);
      if (!source || diskEditInFlight.has(tmdSessionId)) return;
      diskEditInFlight.add(tmdSessionId);
      try {
        const since = diskEditWatermark.get(tmdSessionId) ?? Date.now();
        const edits = await source.adapter(source.id.cwd, source.id.cliId, since).catch(() => null);
        if (!edits) return;
        for (const e of edits) recordEdit(source.id.cwd, source.id.cliId, source.id.tmdId, e.path, e.ts);
        diskEditWatermark.set(tmdSessionId, Math.max(since, ...edits.map((e) => e.ts)));
      } finally {
        diskEditInFlight.delete(tmdSessionId);
      }
    };

    // 轻轮询:事件落账延迟 ≤ 拉取间隔,open 批次随 6s 面板刷新可见;
    // 无适配器会话空转一次 Map/Set 查询,开销可忽略。
    // 全局 setInterval(非 window.):activate 会被 node 环境的契约测试直调。
    setInterval(() => {
      for (const s of host.getSessions()) {
        if (diskEditSource(s.id)) void pullSessionEdits(s.id);
      }
    }, 4000);

    // 批次边界:prompt 发送瞬间记锚点(失败不阻塞,store 内部重试)。
    // 归因模式随锚点固化:profile 声明 editMarks 或 readSessionEdits →
    // events(AI 写入事件流),否则 git(窗口推断)。
    ctx.events.on<PromptSentEvent>(KernelTopics.promptSent, ({ sessionId, text }) => {
      const id = identity(sessionId);
      if (!id) return;
      const session = host.getSessions().find((s) => s.id === sessionId);
      const profile = session ? host.getCliProfile(session.profileId) : undefined;
      const eventsMode =
        (profile?.editMarks?.length ?? 0) > 0 || profile?.readSessionEdits != null;
      const capture = () =>
        captureAnchor(id.cwd, id.cliId, id.tmdId, text, anchorMeta(sessionId), eventsMode ? "events" : "git");
      /* 磁盘事件源:先拉净上一轮尾巴再落锚 —— record_edit 恒记入最新 open
         锚点,锚点落地后才拉到的前轮事件会错记新轮(ts 守卫再兜一道);
         用 CLI 磁盘身份作 key:重启/resume 后 tmd 会话 id 会换,稳定 id 才能找回历史批次 */
      if (profile?.readSessionEdits) void pullSessionEdits(sessionId).then(capture, capture);
      else capture();
    });

    // AI 写入事件流式记账(events 归因主信号;git 归因会话后端直接丢弃)
    ctx.events.on<FileEditEvent>(KernelTopics.fileEditDetected, ({ sessionId, paths }) => {
      const id = identity(sessionId);
      if (!id) return;
      for (const p of paths) recordEdit(id.cwd, id.cliId, id.tmdId, p);
    });

    // 一轮对话结算:封口落账(幂等;失败由下一条 prompt 的隐式封口兜底)。
    // 磁盘事件源先拉最后一次(结算前 omp 已把全部 toolResult 刷盘,尾部拉取
    // 即完整轮内事件),落账完成再封口。
    const sealWith = (sessionId: string) => {
      const id = identity(sessionId);
      if (!id) return;
      const seal = () => sealTurn(id.cwd, id.cliId, id.tmdId);
      if (diskEditSource(sessionId)) void pullSessionEdits(sessionId).then(seal, seal);
      else seal();
    };
    ctx.events.on<TurnSettledEvent>(KernelTopics.turnSettled, ({ sessionId }) => sealWith(sessionId));

    // 会话退出:兜底封口,最后一轮落账(host.removeSession 先 await IPC 再摘会话,
    // emit 时会话与 CLI 身份仍在列表里 —— 依赖此顺序,勿在 identity 前做异步查询)
    ctx.events.on<string>(KernelTopics.sessionExited, (sessionId) => sealWith(sessionId));
  },
};
