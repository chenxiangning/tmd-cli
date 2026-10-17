/**
 * Agent Wiki tab 开关 —— 唯一定义(面板/入口共用,避免循环依赖)。
 * 同构 console/consoleTab.ts(memory-console 先例)。
 */

import { closeTab, getTabs, openTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";

/** 面板/入口打开 wiki tab(唯一定义,避免循环依赖)。 */
function openWikiTab(): void {
  openTab({
    id: "agent-wiki",
    title: t("Agent Wiki"),
    path: "Agent Wiki",
    kind: "agent-wiki",
    payload: {},
  });
}

/** 已打开则关闭,未打开则打开(Memory 面板底部切换按钮)。 */
export function toggleWikiTab(): void {
  if (getTabs().some((tab) => tab.id === "agent-wiki")) closeTab("agent-wiki");
  else openWikiTab();
}
