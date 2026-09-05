/**
 * terminal 插件 —— 内置终端:本地默认 shell 的一等 PTY 会话。
 *
 * 注册面:
 * - header.leftCluster:头部左区按钮簇入口(聚焦最新/新建,Option 强制新建)
 *
 * 会话装配在 kernel/shellSessions.ts(SSH 一等会话同构):幕布/翻页/搜索/
 * tab 条全链路复用;kind="shell" 会话无 composer、不参与 AskWatch(非 CLI)。
 * 侧栏分组见 workspace 插件 ShellSessionGroup(kind 是内核级会话概念)。
 */

import { SquareTerminal } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { TerminalButton } from "./TerminalButton";

export const terminalPlugin: Plugin = {
  id: "terminal",
  meta: {
    name: "内置终端",
    abbr: "SH",
    desc: "本地默认 shell 终端会话(zsh/bash/cmd),复用幕布全链路",
    icon: SquareTerminal,
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("header.leftCluster", { component: TerminalButton });
  },
};
