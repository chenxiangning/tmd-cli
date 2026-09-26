/**
 * session-search 插件 —— 会话历史检索(工作区作用域,用户消息全文)。
 * 数据面零新增:CliProfile.readSessionUserMessages(锚点栏同源)+ openDiskSession 续聊。
 * 命令入口(命令抽屉/改键可达):session-search.open。
 */

import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { SessionSearchOverlay } from "./SearchOverlay";
import { openSessionSearch } from "./overlayStore";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const sessionSearchPlugin: Plugin = {
  id: "session-search",
  meta: {
    name: "会话检索",
    abbr: "SS",
    desc: "按你输入过的内容检索本工作区的历史会话,一键续聊",
    icon: MagnifyingGlass,
    iconColor: "#7C6CF5",
    category: "feature",
  },
  activate(ctx) {
    ctx.registerCommand({
      id: "session-search.open",
      title: t("搜索会话历史…"),
      run: openSessionSearch,
    });
    ctx.contribute("overlay", { order: 60, component: SessionSearchOverlay });
  },
};
