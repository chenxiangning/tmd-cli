/**
 * mcp-hub 插件 —— 跨引擎 MCP 配置写回管理 + 三源商店 + 导入桥。
 *
 * 注册点:
 * - 右栏 filePanel("mcp-hub"):每引擎 server 计数概览(只读,管理动作收口中央 tab);
 * - 中央 tab 内容(kind "mcphub"):引擎栏 + 服务器/商店/导入三视图。
 *
 * 存储模式 = 写回各家 CLI 自己的配置文件(tmd 不做 MCP 真相源/客户端):
 * 引擎清单来自 CliProfile.mcpGlobalConfig 声明(未声明 = 该引擎无管理面);
 * 读写原语在 cli-shared/mcpWrite(声明先例见其头注);
 * 连通测试 = 一次性握手(stdio 走 Rust mcp_probe;http/sse 前端握手),
 * 不做长驻 MCP client / call_tool(上游调研否决 C)。
 * 设计:openspec/changes/2026-09-28-mcp-hub-plugin/proposal.md
 */
import { PlugsConnected } from "@phosphor-icons/react";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { McpHubPanel } from "./McpHubPanel";
import { McpHubTab } from "./McpHubTab";
import { MCP_HUB_TAB_KIND } from "./hubTab";
import { refreshHub } from "./hubStore";
import "./locales"; /* 域词典随插件自带:import 即注册(en/ja,勿删) */
import "./mcp-hub.css";

export const mcpHubPlugin: Plugin = {
  id: "mcp-hub",
  meta: {
    name: "MCP 管理",
    abbr: "MCP",
    desc: "跨引擎 MCP 配置写回管理:增删改直写各家配置文件,附三源商店与导入桥",
    icon: PlugsConnected,
    iconColor: "#C084FC",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerFilePanel({
      id: "mcp-hub",
      label: "MCP",
      icon: PlugsConnected,
      component: McpHubPanel,
      showFileSubbar: false, /* 概览自带摘要行(MCP · 引擎数 · server 数) */
      order: 4, /* 紧随 cli-config(3):配置管理语义相邻 */
      refresh: () => refreshHub(),
    });
    /* 中央管理 tab:kind "mcphub" 路由(kernel/tabs 注册表)。 */
    ctx.registerTabContent({ kind: MCP_HUB_TAB_KIND, component: McpHubTab });
  },
};
