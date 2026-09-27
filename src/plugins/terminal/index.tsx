/**
 * terminal 插件 —— 内置终端:本地默认 shell 的一等 PTY 会话。
 *
 * 注册面:
 * - 右缘 rail 直挂动作(2026-09-27 自 header.leftCluster 按钮迁来,与 WSL 同款):
 *   点击聚焦最新/新建,⌥/⌘/Ctrl+点击强制新建;激活态随活跃会话是否 shell。
 *
 * 会话装配在 kernel/shellSessions.ts(SSH 一等会话同构):幕布/翻页/搜索/
 * tab 条全链路复用;kind="shell" 会话无 composer、不参与 AskWatch(非 CLI)。
 * 侧栏分组见 workspace 插件 ShellSessionGroup(kind 是内核级会话概念)。
 */

import { TerminalWindow } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { host } from "@kernel/host";

/** 在途创建 Promise(shell 会话 spawn 装配未落地期间再点直接忽略)。 */
let creating: Promise<unknown> | null = null;
/** 打开/聚焦终端:聚焦最新(createdAt 最大)的 shell 会话,无则新建;forceNew 强制新建。 */
function open(forceNew: boolean) {
  if (creating) return;
  if (!forceNew) {
    const latest = host
      .getSessions()
      .filter((s) => s.kind === "shell")
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    if (latest) {
      host.setActiveSession(latest.id);
      return;
    }
  }
  /* 失败已广播 sessionStartFailed(StartFailureToast 呈现),这里吞掉即可 */
  creating = host
    .createShellSession()
    .catch(() => undefined)
    .finally(() => {
      creating = null;
    });
}

export const terminalPlugin: Plugin = {
  id: "terminal",
  meta: {
    name: "内置终端",
    abbr: "SH",
    desc: "本地默认 shell 终端会话(zsh/bash/cmd),复用幕布全链路",
    icon: TerminalWindow,
    category: "feature",
  },
  activate(ctx) {
    ctx.registerSidebarAction({
      id: "terminal",
      label: "内置终端",
      icon: TerminalWindow,
      order: 27,
      rail: true,
      active: () =>
        host.getSessions().find((s) => s.id === host.getActiveSessionId())?.kind === "shell",
      onSelect: (_anchor, mods) =>
        open(!!mods && (mods.altKey || mods.metaKey || mods.ctrlKey)),
    });
  },
};
