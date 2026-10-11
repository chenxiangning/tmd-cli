/**
 * 工作台 · 页签契约与条目(纯数据,自 WbScreen.tsx 拆出守
 * only-export-components)。
 */

import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";
import { docKinds } from "./prompt";

export type WbTab = "overview" | "board" | "list" | "calendar" | "timeline" | "followups" | "journal";

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

/** 打开项目详情中央 tab。 */
export function openProjectTab(projectId: string, title: string): void {
  openTab({
    id: `wb-project:${projectId}`,
    kind: WB_PROJECT_TAB_KIND,
    title,
    path: t("工作台"),
    payload: { projectId },
  });
}

/** 顶栏/概要共用的文档类型清单(进展分析 + 四种草稿);点击 → 预览弹层。 */
export function docRequests(): Array<{ kind: string; label: string }> {
  return [
    { kind: "analysis", label: t("进展分析提示词") },
    ...docKinds().map((doc) => ({ kind: doc.value, label: doc.label })),
  ];
}

export const WB_TAB_ITEMS: readonly { key: WbTab; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "board", label: "任务看板" },
  { key: "list", label: "项目列表" },
  { key: "calendar", label: "日历" },
  { key: "timeline", label: "时间线" },
  { key: "followups", label: "待跟进" },
  { key: "journal", label: "日志" },
];
