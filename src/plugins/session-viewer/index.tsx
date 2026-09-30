/**
 * session-viewer 插件 —— 会话只读转录查看器(monocode 渲染形态参考)。
 *
 * 注册点:registerTabContent(kind "session-view")只读查看 tab;contribute
 * (editorCenter.canvasOverlay)活会话转录浮层(幕布|转录双视图)。入口 =
 * workspace 会话行 view icon(kernel sessionViewTabs 深链)/ 画布浮层切换 pill。
 * 零 PTY:数据源 = 各 cli-* 插件声明的 readSessionTranscript(只读磁盘)。
 * 设计:docs/superpowers/specs/2026-09-28-session-viewer-design.md
 * 与 docs/superpowers/specs/2026-09-30-live-transcript-view-design.md
 */
import type { Plugin, PluginContext } from "@kernel/plugin";
import { EyeIcon, Scroll } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { SESSION_VIEW_TAB_KIND } from "@kernel/sessionViewTabs";
import { SessionViewerTab } from "./viewerTab";
import { LiveTranscriptOverlay } from "./liveOverlay";
import { LiveTranscriptPill } from "./livePill";
import { pruneLiveTranscript } from "./liveMode";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */

export const sessionViewerPlugin: Plugin = {
  id: "session-viewer",
  meta: {
    name: "会话查看器",
    abbr: "查看",
    desc: "会话列表 view icon 打开只读转录;画布浮层切活会话结构化视图,幕布保活",
    icon: EyeIcon,
    iconColor: "#9A8FBF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({ kind: SESSION_VIEW_TAB_KIND, component: SessionViewerTab, icon: Scroll });
    ctx.contribute("editorCenter.canvasOverlay", { component: LiveTranscriptOverlay });
    ctx.contribute("terminal.canvasRow", { component: LiveTranscriptPill });
    /* 会话退出剪除转录视图模式(防 store 单调增长;payload = 裸 sessionId)。 */
    host.events.on<string>(KernelTopics.sessionExited, (id) => pruneLiveTranscript(id));
  },
};
