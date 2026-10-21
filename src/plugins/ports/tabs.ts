/**
 * ports · 中央 tab 契约与打开封装(kind 路由注册表 + 幂等 openTab,先例 animStores)。
 */

import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";

export const PORTS_TAB_KIND = "ports.manager";
export const PORTS_TAB_ID = "ports-manager";

/** 打开/激活端口管理 tab(侧栏入口共用)。 */
export function openPortsTab(): void {
  openTab({
    id: PORTS_TAB_ID,
    kind: PORTS_TAB_KIND,
    title: t("端口管理"),
    path: "ports",
    payload: {},
  });
}
