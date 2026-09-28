/**
 * P5 导入桥扫描 —— 扫本机其他工具的 MCP 配置(路径集固定 + 手选任意文件),
 * transport 推断复用 entryModel(显式 type 优先;command→stdio / url→http)。
 * 同名多源保留首个(扫描序 = 优先级序);导入 = 深拷贝经 mcpWrite 写入
 * 目标引擎(同样走 .bak-tmd,ImportView 调 hubStore.upsertServer)。
 * 扫描集(提案 §4.7):~/.claude.json 顶层 / ~/.mcp.json / ~/.codex/config.toml /
 * Claude Desktop(按平台)/ ~/.codebuddy/mcp.json + 手选文件(JSON mcpServers
 * 或 TOML [mcp_servers.*],按扩展名与内容双探测)。
 */

import { ipc, platformKind } from "@kernel/ipc";
import { parseJsonMcpServers, parseTomlMcpServers, type McpServerEntry } from "@plugins/cli-shared/mcpWrite";

/** 一条可导入候选(source = 来源标签,显示用)。 */
export interface ImportCandidate {
  source: string;
  path: string;
  id: string;
  entry: McpServerEntry;
}

/** 读文件文本;缺失/不可读 = null(该来源静默跳过,不整体失败)。 */
async function readText(path: string): Promise<string | null> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return null;
  }
}

/** 解析一个来源文件为候选(JSON mcpServers 或 TOML mcp_servers);
 *  解析失败/空 = [](该文件非 MCP 配置或损坏,不猜)。 */
export async function scanMcpFile(path: string, source: string): Promise<ImportCandidate[]> {
  const text = await readText(path);
  if (text === null || text.trim() === "") return [];
  let entries: Record<string, McpServerEntry> | null = null;
  if (path.endsWith(".toml") || (!path.endsWith(".json") && text.includes("[mcp_servers."))) {
    try {
      entries = parseTomlMcpServers(text);
    } catch {
      return [];
    }
  } else {
    try {
      entries = parseJsonMcpServers(text);
    } catch {
      return [];
    }
  }
  return Object.entries(entries).map(([id, entry]) => ({ source, path, id, entry }));
}

/** Claude Desktop 配置路径(按平台;win 走 %APPDATA%,缺 env = 跳过)。 */
async function claudeDesktopPath(home: string): Promise<string | null> {
  const platform = await platformKind().catch(() => null);
  if (platform === "windows") {
    const appData = await ipc.quotaEnvValue("APPDATA").catch(() => null);
    return appData ? `${appData}\\Claude\\claude_desktop_config.json` : null;
  }
  if (platform === "darwin") {
    return `${home}/Library/Application Support/Claude/claude_desktop_config.json`;
  }
  return `${home}/.config/Claude/claude_desktop_config.json`;
}

/** 扫全部固定来源(顺序 = 同名保留优先级);全缺失 = 空表。 */
export async function scanExternalMcpSources(): Promise<ImportCandidate[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const desktop = await claudeDesktopPath(home);
  const sources: [string, string][] = [
    ["claude.json", `${home}/.claude.json`],
    ["~/.mcp.json", `${home}/.mcp.json`],
    ["codex config.toml", `${home}/.codex/config.toml`],
    ["Claude Desktop", desktop ?? ""],
    ["codebuddy", `${home}/.codebuddy/mcp.json`],
  ];
  const out: ImportCandidate[] = [];
  for (const [source, path] of sources) {
    if (!path) continue;
    for (const candidate of await scanMcpFile(path, source)) {
      if (!out.some((c) => c.id === candidate.id)) out.push(candidate); // 同名保留首个
    }
  }
  return out;
}

/** 合并手选文件的候选进既有清单(同名保留首个:既有清单优先)。 */
export function mergeCandidates(existing: ImportCandidate[], incoming: ImportCandidate[]): ImportCandidate[] {
  const ids = new Set(existing.map((c) => c.id));
  return [...existing, ...incoming.filter((c) => !ids.has(c.id))];
}
