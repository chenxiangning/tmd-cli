/**
 * qoder 双分发版 MCP 服务器发现 —— 真相 = ~/.qoder(或 .qoder-cn)/shared_client/mcp.json
 * 的标准 mcpServers 形状(本机实证;项目级与 TUI 管理命令未实证,不猜)。
 * 点击 = 展示性 insert:description 前置「仅展示 · 无引用语法」(无实证引用/面板
 * 命令前不向幕布写任何 wire;academy 实证后再升级 send)。
 * dataDir 为变体常量(.qoder / .qoder-cn),归各插件目录声明,本层不拼家族知识。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { listMcpServersFromSources } from "./mcpFormat";

/** listMcpServers 契约实现(qoder / qoder-cn 两个 profile 共用工厂接线)。 */
export async function listQoderMcpServers(dataDir: string): Promise<CliSuggestion[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return listMcpServersFromSources(
    [{ path: `${home}/${dataDir}/shared_client/mcp.json`, source: "全局" }],
    { action: "insert", descriptionPrefix: "仅展示 · 无引用语法" },
  );
}
