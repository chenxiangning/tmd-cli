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
import { KernelTopics, type PromptSentEvent, type TurnSettledEvent } from "@kernel/events";
import { registerFilePanel } from "@kernel/filePanel";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { captureAnchor, sealTurn } from "./store";
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

    // 批次边界:prompt 发送瞬间记锚点(失败不阻塞,store 内部重试)
    ctx.events.on<PromptSentEvent>(KernelTopics.promptSent, ({ sessionId, text }) => {
      const id = identity(sessionId);
      if (!id) return;
      /* 用 CLI 磁盘身份作 key:重启/resume 后 tmd 会话 id 会换,稳定 id 才能找回历史批次 */
      captureAnchor(id.cwd, id.cliId, id.tmdId, text);
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
