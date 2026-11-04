/**
 * Memory 控制台 tab 开关 —— 唯一定义(面板/入口共用,避免循环依赖)。
 * 自 MemoryConsole.tsx 拆出(only-export-components 铁则)。
 * E-01:导出幂等 openConsoleTab —— AI 配置导航等「前往」语义用 open
 * (重复 = 聚焦已有),toggle 仍归面板底部切换按钮。
 */

import { closeTab, getTabs, openTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";

/** 打开(或聚焦)Memory 控制台中央 tab。 */
export function openConsoleTab(): void {
  openTab({
    id: "memory-console",
    title: t("Memory 控制台"),
    path: "Magic Context",
    kind: "memory-console",
    payload: {},
  });
}

/** 已打开则关闭,未打开则打开(面板底部切换按钮)。 */
export function toggleConsoleTab(): void {
  if (getTabs().some((tab) => tab.id === "memory-console")) closeTab("memory-console");
  else openConsoleTab();
}
