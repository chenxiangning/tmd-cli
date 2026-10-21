/**
 * ports —— 本机 TCP 监听端口管理插件:右栏入口 → 中央 tab。
 *
 * 零内核/零 Rust 改动:扫描/kill 全走 procCommunicate 通用原语按平台跑系统工具
 * (mac lsof / linux ss→netstat / windows netstat+PowerShell,平台矩阵见 spec);
 * 浏览器打开走 openExternalUrl,会话归因走 host 会话 pid + ppid 链上溯。
 * 设计:docs/superpowers/specs/2026-10-21-ports-manager-design.md
 */
import { Plugs } from "@phosphor-icons/react";
import { lazySuspense } from "@kernel/lazyTab";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { getActiveTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { openPortsTab, PORTS_TAB_KIND } from "./tabs";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const portsPlugin: Plugin = {
  id: "ports",
  meta: {
    name: "端口管理",
    abbr: "端口",
    desc: "本机监听端口一览:进程树折叠、端口释义、仓库认领、会话归因、一键 kill",
    icon: Plugs,
    iconColor: "#5B8BE8",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({
      kind: PORTS_TAB_KIND,
      component: lazySuspense(() => import("./PortsView").then((m) => ({ default: m.PortsView }))),
      icon: Plugs,
    });
    /* 右栏 rail 直挂(机器组,SSH/WSL/终端/结构化会话之后);active = tab 已开,
     *  重渲通知经 tabs store 桥接(先例 structured-session)。 */
    ctx.registerSidebarAction({
      id: "ports",
      label: t("端口管理"),
      icon: Plugs,
      order: 25,
      rail: true,
      railGroup: "machine",
      opensCenterTab: true,
      active: () => getActiveTab()?.kind === PORTS_TAB_KIND,
      onSelect: () => openPortsTab(),
    });
  },
};
