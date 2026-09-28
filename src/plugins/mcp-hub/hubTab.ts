/**
 * mcp-hub tab 契约 —— 右栏面板与中央管理 tab 共同依赖的常量。
 * tab id = "mcp-hub"(幂等单例,重复打开仅聚焦);kind = "mcphub";
 * payload 无内容(引擎/视图选择是组件局部态,不跨 tab 记忆)。
 */

import { openTab } from "@kernel/tabs";

export const MCP_HUB_TAB_KIND = "mcphub";
export const MCP_HUB_TAB_ID = "mcp-hub";

/** 打开(或聚焦)MCP 管理中央 tab;右栏面板与各视图入口共用。 */
export function openMcpHubTab(): void {
  openTab({
    id: MCP_HUB_TAB_ID,
    kind: MCP_HUB_TAB_KIND,
    title: "MCP",
    path: "",
    payload: {},
  });
}
