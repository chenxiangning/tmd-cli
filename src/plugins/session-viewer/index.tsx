/**
 * session-viewer 插件 —— 会话只读转录查看器(monocode 渲染形态参考)。
 *
 * 注册点:registerTabContent(kind "session-view");入口 = workspace 会话行
 * view icon(kernel sessionViewTabs 深链)。零 PTY:数据源 = 各 cli-* 插件
 * 声明的 readSessionTranscript(只读磁盘快照),活会话手动刷新重读。
 * 设计:docs/superpowers/specs/2026-09-28-session-viewer-design.md
 */
import type { Plugin, PluginContext } from "@kernel/plugin";
import { EyeIcon } from "@phosphor-icons/react";
import { SESSION_VIEW_TAB_KIND } from "@kernel/sessionViewTabs";
import { SessionViewerTab } from "./viewerTab";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */

export const sessionViewerPlugin: Plugin = {
  id: "session-viewer",
  meta: {
    name: "会话查看器",
    abbr: "查看",
    desc: "会话列表 view icon 打开只读转录:user/assistant/思考/工具卡,零 PTY",
    icon: EyeIcon,
    iconColor: "#9A8FBF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({ kind: SESSION_VIEW_TAB_KIND, component: SessionViewerTab });
  },
};
