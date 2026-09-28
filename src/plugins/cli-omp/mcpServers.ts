/**
 * omp MCP 服务器发现 —— 真相 = 用户级 ~/.omp/agent/mcp.json(与隐藏名 .mcp.json)
 * 被项目级 .omp/mcp.json|.omp/.mcp.json 同名覆盖(oh-my-pi config-usage 优先级表)。
 * 点击 = send "/mcp ":omp TUI 管理面板(academy 目录实证 17 子命令,omp 18.3.1 取证);
 * 格式解析走 cli-shared/mcpFormat(准入:omp/kimi/qoder 多 JSON 家消费)。
 * 未覆盖层(spec v2 有意裁剪,勿当 bug 重查):omp 上游还扫项目根独立
 * mcp.json/.mcp.json(discovery/mcp-json.ts priority 5)与 profile agentDir 变体;
 * 非默认 profile / KIMI_CODE_HOME 类 env 覆盖同样不尊重(tmd spawn 不设这些 env)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { listMcpServersFromSources } from "../cli-shared/mcpFormat";

/** listMcpServers 契约实现(omp profile);主目录不可得 = null(无此区)。 */
export async function listOmpMcpServers(cwd: string): Promise<CliSuggestion[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return listMcpServersFromSources(
    [
      { path: `${home}/.omp/agent/mcp.json`, source: "全局" },
      { path: `${home}/.omp/agent/.mcp.json`, source: "全局" },
      { path: `${cwd}/.omp/mcp.json`, source: "项目" },
      { path: `${cwd}/.omp/.mcp.json`, source: "项目" },
    ],
    { action: "send", token: "/mcp " },
  );
}
