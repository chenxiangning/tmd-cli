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

    // 批次边界:prompt 发送瞬间记锚点(失败不阻塞,store 内部重试)。
    // 归因模式随锚点固化:profile 声明 editMarks → events(AI 写入事件流),
    // 否则 git(窗口推断)。
    ctx.events.on<PromptSentEvent>(KernelTopics.promptSent, ({ sessionId, text }) => {
      const id = identity(sessionId);
      if (!id) return;
      const session = host.getSessions().find((s) => s.id === sessionId);
      const marks = session
        ? host.getCliProfile(session.profileId)?.editMarks
        : undefined;
      /* 用 CLI 磁盘身份作 key:重启/resume 后 tmd 会话 id 会换,稳定 id 才能找回历史批次 */
      captureAnchor(
        id.cwd,
        id.cliId,
        id.tmdId,
        text,
        anchorMeta(sessionId),
        marks && marks.length > 0 ? "events" : "git",
      );
    });

    // AI 写入事件流式记账(events 归因主信号;git 归因会话后端直接丢弃)
    ctx.events.on<FileEditEvent>(KernelTopics.fileEditDetected, ({ sessionId, paths }) => {
      const id = identity(sessionId);
      if (!id) return;
      for (const p of paths) recordEdit(id.cwd, id.cliId, id.tmdId, p);
    });

    // 一轮对话结算:封口落账(幂等;失败由下一条 prompt 的隐式封口兜底)
    ctx.events.on<TurnSettledEvent>(KernelTopics.turnSettled, ({ sessionId }) => {
      const id = identity(sessionId);
      if (!id) return;
      sealTurn(id.cwd, id.cliId, id.tmdId);
    });

    // 会话退出:兜底封口,最后一轮落账(host.removeSession 先 await IPC 再摘会话,
    // emit 时会话与 CLI 身份仍在列表里 —— 依赖此顺序,勿在 identity 前做异步查询)
    ctx.events.on<string>(KernelTopics.sessionExited, (sessionId) => {
      const id = identity(sessionId);
      if (!id) return;
      sealTurn(id.cwd, id.cliId, id.tmdId);
    });
  },
};
