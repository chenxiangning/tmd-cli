/**
 * session-search 插件 —— 会话历史检索(工作区作用域,用户消息全文)。
 * 数据面零新增:CliProfile.readSessionUserMessages(锚点栏同源)+ openDiskSession 续聊。
 * 命令入口(命令抽屉/改键可达):session-search.open。
 * D-03 共壳:search 启用时命令打开统一壳(kind="sessions",本体由 search 承载,
 * 本插件不再注册 overlay,零双遮罩);search 禁用时回退原壳(SessionOverlay)。
 */

import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { getActiveWorkspace } from "@kernel/workspace";
import { SessionSearchOverlay } from "./SearchOverlay";
import { openSessionSearch } from "./overlayStore";
import { openSearchOverlay } from "@plugins/search/overlayStore";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const sessionSearchPlugin: Plugin = {
  id: "session-search",
  meta: {
    name: "会话检索",
    abbr: "SS",
    desc: t("按你输入过的内容检索历史会话,支持全部工作区,一键续聊"),
    icon: MagnifyingGlass,
    iconColor: "#7C6CF5",
    category: "feature",
  },
  activate(ctx) {
    /* search 启用态(重启生效口径,与插件市场一致):启用 = 统一壳接管会话域。 */
    const searchOff = getSettingsState().settings.disabledPlugins.includes("search");
    ctx.registerCommand({
      id: "session-search.open",
      title: t("搜索会话历史…"),
      keybinding: "Cmd+O",
      run: () => {
        /* 无活动工作区不开浮层:壳置开后无 cwd 会渲染 null,
         * 形成「隐形卡开」——工作区激活瞬间才弹出。 */
        if (!getActiveWorkspace()) return;
        if (searchOff) openSessionSearch();
        else openSearchOverlay("sessions");
      },
    });
    /* 仅 search 禁用时注册原壳;search 启用时统一壳是唯一浮层(无双遮罩)。 */
    if (searchOff) {
      ctx.contribute("overlay", { order: 60, component: SessionSearchOverlay });
    }
  },
};
