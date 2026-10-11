/**
 * 工作台 · 页签契约与条目(纯数据,自 WbScreen.tsx 拆出守
 * only-export-components)。
 */

import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";

export type WbTab = "overview" | "board" | "list" | "timeline" | "followups" | "docs" | "journal";

/** 工作台本页中央 tab。 */
export const WB_CONSOLE_TAB_KIND = "wb.console";
export const WB_CONSOLE_TAB_ID = "wb-console";

/** 打开/激活工作台本页 tab(侧栏入口与深链共用)。 */
export function openWorkbenchTab(): void {
  openTab({
    id: WB_CONSOLE_TAB_ID,
    kind: WB_CONSOLE_TAB_KIND,
    title: t("工作台"),
    path: t("工作台"),
    payload: {},
  });
}

/** 项目详情中央 tab(kernel/tabs 路由;插件 activate 期注册内容组件)。 */
export const WB_PROJECT_TAB_KIND = "wb.project";

/** 打开项目详情中央 tab(focusTab 可直落概要/文档/任务/进展/会话某页签;溯源跳转用)。 */
export function openProjectTab(projectId: string, title: string, focusTab?: string): void {
  openTab({
    id: `wb-project:${projectId}`,
    kind: WB_PROJECT_TAB_KIND,
    title,
    path: t("工作台"),
    payload: focusTab ? { projectId, focusTab } : { projectId },
  });
}

/** 打开/激活工作台「文档」页签(项目详情「本项目生成记录」深链;可带项目过滤)。 */
export function openWorkbenchDocsTab(projectFilter?: string): void {
  openTab({
    id: WB_CONSOLE_TAB_ID,
    kind: WB_CONSOLE_TAB_KIND,
    title: t("工作台"),
    path: t("工作台"),
    payload: { tab: "docs", projectFilter },
  });
}

export const WB_TAB_ITEMS: readonly { key: WbTab; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "board", label: "任务看板" },
  { key: "list", label: "项目列表" },
  { key: "timeline", label: "时间线" },
  { key: "followups", label: "待跟进" },
  { key: "docs", label: "文档" },
  { key: "journal", label: "工作日志" },
];
