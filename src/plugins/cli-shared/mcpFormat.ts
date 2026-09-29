/**
 * MCP 配置共享发现层 —— `[mcp_servers.*]` TOML 段提取(cli-codex 重构消费 +
 * cli-grok 新消费,2 家)与 `mcpServers` JSON 键提取(cli-omp / cli-kimi /
 * cli-qoder 双版 3 家消费)。准入见 AGENTS.md cli-shared 铁律;
 * 先例声明:横跨多 CLI 家族的格式知识(同 sessionUsage 先例)。
 *
 * 读盘走 ipc.fsReadFile 通用原语,路径由各插件拼装(各家居所知识留插件侧);
 * 本层不理解点击语义 —— 条目 action/token 由调用方声明(send 面板命令 / 展示性 insert)。
 * 解析失败 = 空数组;全部文件缺失 = null(对齐「缺失不猜测」与抽屉「失败 = 分区空」)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";

/** TOML `[mcp_servers.<name>]` 段头(单段名,点分子键不算服务器;允许带引号形式、
 *  段名内空格、行尾注释)。 */
const MCP_SERVER_HEADER = /^\[\s*mcp_servers\.\s*(?:"([^"]+)"|([^\].]+?))\s*\]\s*(?:#.*)?$/;

/**
 * 行级提取 `[mcp_servers.*]` 段名与可选 command 键(不引 TOML 库,同
 * cli-shared/grokConfig 先例:抽屉只需名与命令,全解析属过度工程)。保序去重。
 */
export function extractTomlMcpServers(toml: string): { name: string; command?: string }[] {
  const found: { name: string; command?: string }[] = [];
  const seen = new Set<string>();
  let current: { name: string; command?: string } | null = null;
  const flush = () => {
    if (!current || seen.has(current.name)) return;
    seen.add(current.name);
    found.push(current);
  };
  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    const header = line.match(MCP_SERVER_HEADER);
    if (header) {
      flush();
      const name = (header[1] ?? header[2] ?? "").trim();
      current = name ? { name } : null;
      continue;
    }
    if (!current) continue;
    const cmd = line.match(/^command\s*=\s*"([^"]*)"/);
    if (cmd) current.command = cmd[1];
  }
  flush();
  return found;
}

/**
 * 从 JSON 文本提取顶层 `mcpServers` 对象键名(保序去重)。
 * 解析失败 / 非对象 / 无该键 = 空数组(不猜)。claude 的 projects.<cwd>
 * 嵌套覆盖属其私有格式,由 cli-claude 自行处理,本层不收纳。
 */
export function extractJsonMcpServerNames(json: string): string[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = (root as Record<string, unknown> | null)?.mcpServers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of Object.keys(raw)) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** 单层 MCP 配置文件源:路径 + 来源徽标("全局"/"项目",kernel cli 域既有键)。 */
export interface McpSource {
  path: string;
  source: string;
  /** 缺省 "json";"toml" 走 [mcp_servers.*] 段提取。 */
  format?: "json" | "toml";
}

/** 点击语义:send = 已有实证的面板管理命令(如 "/mcp ");insert = 无引用语法引擎的展示性条目。 */
export type McpClick =
  | { action: "send"; token: string }
  | { action: "insert"; descriptionPrefix: string };

/**
 * 读一组 MCP 配置文件并合成条目(层序 = 优先级序:同名后层覆盖来源徽标,
 * 位置保持先层 —— 全局在前、项目在后)。全部文件缺失 = null;任一存在 = 条目(可空)。
 * 文件读失败按缺失处理(catch → ""),永不大面积失败。
 */
export async function listMcpServersFromSources(
  sources: readonly McpSource[],
  click: McpClick,
): Promise<CliSuggestion[] | null> {
  const byName = new Map<string, string>();
  let anyRead = false;
  for (const { path, source, format = "json" } of sources) {
    const text = await ipc.fsReadFile(path).catch(() => "");
    if (!text) continue;
    anyRead = true;
    const names =
      format === "toml"
        ? extractTomlMcpServers(text).map((s) => s.name)
        : extractJsonMcpServerNames(text);
    for (const name of names) byName.set(name, source);
  }
  if (!anyRead) return null;
  /* description 存中文源串不在生成期 t():fetchKind 有 60s 缓存,跨语言切换会
     把旧语言拼进缓存条目;消费点(DrawerItemList)渲染期 t(field) 包裹(契约见 kernel/i18n.ts 头注)。
     整串键已入 kernel locales cli 域(en/ja)。 */
  return Array.from(byName, ([name, source]) =>
    click.action === "send"
      ? {
          value: name,
          description: `MCP · ${source}`,
          action: "send" as const,
          icon: "server",
          token: click.token,
        }
      : {
          value: name,
          description: `${click.descriptionPrefix} · MCP · ${source}`,
          action: "insert" as const,
          icon: "server",
          token: `${name} `,
        },
  );
}
