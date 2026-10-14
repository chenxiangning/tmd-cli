/**
 * anim · 中央 tab 契约与打开封装(纯函数自 index.tsx 拆出守
 * only-export-components,先例 workbench/wbTabs)。
 */

import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";

/** tmd-anim 项目列表中央 tab(kernel/tabs kind 路由注册表)。 */
export const ANIM_TAB_KIND = "anim.projects";
export const ANIM_TAB_ID = "anim-projects";

/** 打开/激活项目列表 tab(侧栏入口共用;openTab 幂等语义)。 */
export function openAnimTab(): void {
  openTab({
    id: ANIM_TAB_ID,
    kind: ANIM_TAB_KIND,
    title: t("动画项目"),
    path: "tmd-anim",
    payload: {},
  });
}
