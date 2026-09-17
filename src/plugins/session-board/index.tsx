/**
 * session-board 插件 —— 会话看板:热力月历 + 泳道时间线日视图。
 *
 * 注册点:
 * - overlay 挂点:与插件市场同款全屏覆盖层切换(不透明盖住三栏,下层零回放);
 * - 头部左区按钮簇(header.leftCluster):左上角日历图标开关看板覆盖层;
 * - 侧栏快捷动作:同开关。
 * 数据/状态层零新增:全部复用 workspace 同款内核通道(见 boardData.ts 头注)。
 */
import { CalendarDots } from "@phosphor-icons/react";
import { KernelTopics } from "@kernel/events";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { BoardOverlay } from "./BoardOverlay";
import { BoardButton } from "./BoardButton";
import { boardOverlayOpen, toggleBoardOverlay } from "./boardOverlayStore";
import { archiveExitedSession } from "./boardExit";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */

export const sessionBoardPlugin: Plugin = {
  id: "session-board",
  meta: {
    name: "会话看板",
    abbr: "看板",
    desc: "热力月历 + 泳道时间线:按日回溯会话、未查看治理、行内重命名",
    icon: CalendarDots,
    iconColor: "#8FBF6A",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.contribute("overlay", { order: 40, component: BoardOverlay });
    ctx.contribute("header.leftCluster", { component: BoardButton });
    /* 生命周期收口:干净退出的会话自动归档(定义见 boardExit.ts 头注)。 */
    ctx.events.on<string>(KernelTopics.sessionExited, archiveExitedSession);
    ctx.registerSidebarAction({
      id: "session-board",
      label: "会话看板",
      icon: CalendarDots,
      order: 30,
      onSelect: toggleBoardOverlay,
      active: boardOverlayOpen,
    });
  },
};
