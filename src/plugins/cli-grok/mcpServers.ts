/**
 * grok MCP 服务器发现 —— 真相 = 用户级 ~/.grok/config.toml 的 [mcp_servers.*]
 * 段,项目级 <cwd>/.grok/config.toml 同名覆盖(官方 README;TOML 段提取走
 * cli-shared/mcpFormat,与 cli-codex 共享)。
 * 未覆盖层(spec v2 有意裁剪):官方语义项目配置可逐级向上扫,本适配器只读
 * <cwd> 单层;用户报「上级目录 server 不显示」时补 while-parent 循环即可。
 * 点击 = send "/mcps "(academy 实证,复数);配置增删走 grok mcp add/doctor,非本入口语义。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { listMcpServersFromSources } from "../cli-shared/mcpFormat";

/** listMcpServers 契约实现(grok profile);主目录不可得 = null(无此区)。 */
export async function listGrokMcpServers(cwd: string): Promise<CliSuggestion[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return listMcpServersFromSources(
    [
      { path: `${home}/.grok/config.toml`, source: "全局", format: "toml" },
      { path: `${cwd}/.grok/config.toml`, source: "项目", format: "toml" },
    ],
    { action: "send", token: "/mcps " },
  );
}
