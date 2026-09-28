/**
 * MCP 配置共享写引擎 —— 与 mcpFormat.ts 同一格式域先例(JSON `mcpServers`
 * 家 omp/kimi/qoder/claude + TOML `[mcp_servers.*]` 家 codex/grok)。准入:
 * 六个 cli-* 插件声明管理面 + mcp-hub feature 插件联合消费(≥2 消费方)。
 *
 * 纯文本变换层,零 IO;服务器条目 = 原生形状透传(各家方言,不做统一抽象):
 * - JSON 家:全量 parse/stringify(2 空格缩进 + 末尾换行;JSON 无注释,
 *   未知顶层键原样保留)。解析失败 = 抛错,调用方显错误态拒写(不猜)。
 * - TOML 家(mcpToml 底座):行级段操作(定位 `[mcp_servers.x]` 及其子表段
 *   的行界,整段替换/删除;新增 = 文件尾追加)。其他段、段外注释逐行原样
 *   保留;序列化仅覆盖常见值形状,遇不可序列化形状抛错拒写。
 * 写回壳(.bak-tmd 备份 → 写回)在 mcp-hub hubStore;本层不理解点击语义。
 */
import {
  absorbTrailingBlanks,
  scanSegments,
  serializeTomlServer,
  type McpServerEntry,
} from "./mcpToml";

export type { McpServerEntry } from "./mcpToml";
export { parseTomlMcpServers, serializeTomlServer } from "./mcpToml";

/* ── JSON 家(omp ~/.omp/agent/mcp.json · kimi ~/.kimi-code/mcp.json ·
 *    qoder ~/.qoder/shared_client/mcp.json · claude ~/.claude.json 顶层)── */

/** 解析 JSON 文本顶层 `mcpServers`(读侧全文入口);无该键 = {};形状不对抛错。 */
export function parseJsonMcpServers(rawText: string): Record<string, McpServerEntry> {
  const data: unknown = JSON.parse(requireJsonObject(rawText));
  const servers = (data as Record<string, unknown>).mcpServers;
  if (servers === undefined) return {};
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("mcpServers 不是对象");
  }
  return servers as Record<string, McpServerEntry>;
}

/** JSON.parse 语义修饰:空/纯空白文本视为待建基线 {}(首存即建语义),
 *  非空但不可解析 = 抛错(拒写,不掩盖)。 */
function requireJsonObject(rawText: string): string {
  if (rawText.trim() === "") return "{}";
  return rawText;
}

/** 解析整份 JSON 文档为对象;形状不对抛错(写通道共用闸)。 */
function parseDoc(rawText: string): Record<string, unknown> {
  const data: unknown = JSON.parse(requireJsonObject(rawText));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("顶层不是 JSON 对象");
  }
  return data as Record<string, unknown>;
}

/** upsert 一批 server(同名整条替换);其他顶层键原样保留。 */
export function writeJsonMcpServers(
  rawText: string,
  servers: Record<string, McpServerEntry>,
): string {
  const data = parseDoc(rawText);
  const existing = data.mcpServers;
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
    throw new Error("mcpServers 不是对象");
  }
  data.mcpServers = { ...(existing as Record<string, unknown> ?? {}), ...servers };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** 删除一个 server;名不存在仍全量重序列化(键序归一副作用,注释不保留)。
 *  mcpServers 键保留(可为空对象)。 */
export function removeJsonMcpServer(rawText: string, name: string): string {
  const data = parseDoc(rawText);
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (servers && typeof servers === "object" && !Array.isArray(servers) && name in servers) {
    delete servers[name];
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

/* ── TOML 家(codex ~/.codex/config.toml · grok ~/.grok/config.toml)──── */

/** 段尾追加(新名 server):保持既有结尾字节,只补分隔空行与新段。 */
function appendSection(text: string, section: string): string {
  if (text === "") return section;
  const base = text.endsWith("\n") ? text : `${text}\n`;
  return base.endsWith("\n\n") ? base + section : `${base}\n${section}`;
}

/** upsert 一个 server:已有 = 整段替换(主段 + 全部子表段,可跨无关段);
 *  新名 = 文件尾追加。其他段与注释逐行原样保留。 */
export function upsertTomlMcpServer(
  rawText: string,
  name: string,
  entry: McpServerEntry,
): string {
  const lines = rawText.split("\n");
  const owned = scanSegments(rawText)
    .filter((s) => s.name === name)
    .map((s) => absorbTrailingBlanks(lines, s));
  const section = serializeTomlServer(name, entry);
  if (owned.length === 0) return appendSection(rawText, section);
  const drop = new Set<number>();
  for (const seg of owned) for (let i = seg.start; i < seg.end; i++) drop.add(i);
  const insertAt = owned[0].start;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === insertAt) out.push(section);
    if (!drop.has(i)) out.push(lines[i]);
  }
  if (insertAt >= lines.length) out.push(section);
  return out.join("\n");
}

/** 删除一个 server(主段 + 子表段);名不存在 = 原样返回(幂等)。 */
export function removeTomlMcpServer(rawText: string, name: string): string {
  const lines = rawText.split("\n");
  const owned = scanSegments(rawText)
    .filter((s) => s.name === name)
    .map((s) => absorbTrailingBlanks(lines, s));
  if (owned.length === 0) return rawText;
  const drop = new Set<number>();
  for (const seg of owned) for (let i = seg.start; i < seg.end; i++) drop.add(i);
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}
