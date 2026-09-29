/**
 * kimi MCP 服务器发现 —— 真相 = 用户级 ~/.kimi-code/mcp.json 与项目级
 * <cwd>/.kimi-code/mcp.json(kimi-code dist configLoader 实证三层读源,项目根
 * .mcp.json 一层属 claude 兼容,不在本抽屉复现——同名冲突以项目覆盖全局)。
 * 旧居 ~/.kimi/ 无服务器存储(仅 [mcp.client] 超时残留),不扫。
 * 点击 = send "/mcp ":kimi TUI 状态面板(dist 实证 "Show MCP server status";
 * 配置面是 /mcp-config,非本入口语义)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { listMcpServersFromSources } from "../cli-shared/mcpFormat";

/** listMcpServers 契约实现(kimi profile);主目录不可得 = null(无此区)。 */
export async function listKimiMcpServers(cwd: string): Promise<CliSuggestion[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return listMcpServersFromSources(
    [
      { path: `${home}/.kimi-code/mcp.json`, source: "全局" },
      { path: `${cwd}/.kimi-code/mcp.json`, source: "项目" },
    ],
    { action: "send", token: "/mcp " },
  );
}
