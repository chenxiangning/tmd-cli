/**
 * checkpoints 插件 —— 批次审批/回退(spec: docs/superpowers/specs/2026-09-02-checkpoints-batch-review-design.md)。
 *
 * 职责:批次生命周期(锚点快照时机) + 批次 UI(右栏时间线 + 中央审阅单)。
 * 快照存储/diff/还原全部是后端原语(src-tauri/src/checkpoints);本插件不理解 git 细节。
 * 与 git 插件零耦合:回退直接作用于工作区,不产生任何 git 侧写操作。
 *
 * 批次边界 = 用户 prompt:composer emit kernel.sessions.prompt → 锚点快照;
 * 下一条 prompt 到来时上一批自动封口(快照对推导,不解析 CLI 工具流)。
 */

import { History } from "lucide-react";
import { host } from "@kernel/host";
import { KernelTopics, type PromptSentEvent } from "@kernel/events";
import { registerFilePanel } from "@kernel/filePanel";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { captureAnchor } from "./store";
import { CheckpointsPanel } from "./CheckpointsPanel";
import { BatchSheetTabContent } from "./BatchSheet";

export const checkpointsPlugin: Plugin = {
  id: "checkpoints",
  meta: {
    name: "批次审批",
    abbr: "CK",
    desc: "AI 改动按轮成批:审 diff、整批或按文件回退",
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

    // 批次边界信号:prompt 发送瞬间打锚点快照(失败不阻塞,store 内部重试)
    ctx.events.on<KernelEvent>(KernelTopics.promptSent, ({ sessionId, text }) => {
      const session = host.getSessions().find((s) => s.id === sessionId);
      if (!session) return;
      captureAnchor(session.cwd, sessionId, text);
    });
  },
};

type KernelEvent = PromptSentEvent;
