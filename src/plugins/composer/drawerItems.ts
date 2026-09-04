/**
 * 命令抽屉数据源 —— 四分区(命令/技能/MCP/插件)统一收口。
 *
 * 职责边界(proposal D1/D6/D7;2026-09-04 起 command/skill 改为静态×动态合并):
 * - command/skill:listSuggestions 动态发现(60s TTL 缓存)与静态 suggestions
 *   按 value 去重合并(静态在前保留调校过的 action/token),动态 null/失败回退静态
 * - mcp:listMcpServers 声明式,无静态兜底,失败 = 分区为空;未声明 = 无此区
 * - plugin:内核 listPluginStates() ∩ feature 类,与 CLI 无关,不走缓存(启用态即时反映)
 * - 本模块不理解任何 CLI 语法;wire/插入文本由每项 action/token 声明
 */

import type { ComponentType } from "react";
import { host } from "@kernel/host";
import { getFilePanels, type FilePanelIcon } from "@kernel/filePanel";
import type { CliProfile, CliSuggestion, SuggestionAction } from "@kernel/cli";

/** 抽屉分区;plugin 区数据来自内核注册表,与 CLI profile 无关。 */
export type DrawerSection = "command" | "skill" | "mcp" | "plugin";

/** 抽屉条目 —— UI 渲染与点击执行的统一形状。 */
export interface DrawerItem {
  section: DrawerSection;
  /** 命令/技能名或插件显示名。 */
  name: string;
  description?: string;
  /** open = 打开插件面板(仅 plugin 区)。 */
  action: SuggestionAction | "open";
  /** 语义图标名(drawerIcons 内置集);缺省按 section 回退 glyph。 */
  icon?: string;
  /** plugin 区:命中已注册右栏面板时,面板自带图标(与右栏 tab 同源,零硬编码)。 */
  iconNode?: ComponentType<{ size?: number | string; className?: string }>;
  /** 完整 wire/插入文本,覆盖按 section 合成的默认值。 */
  token?: string;
  /** plugin 区:命中已注册右栏面板的面板 id(点击 setFilePanelMode)。 */
  panelId?: string;
  /** plugin 区:无面板兜底 = 打开设置面板。 */
  openSettings?: boolean;
}

/* ---------- 命令/技能/MCP:静态表 + 运行时发现(60s TTL 缓存) ---------- */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; items: CliSuggestion[] }>();

/** 测试专用:清空 provider 结果缓存(静态表不经过缓存)。 */
export function clearDrawerItemsCache(): void {
  cache.clear();
}

/**
 * 静态表 × 动态发现合并(纯函数,suggest.ts 与抽屉共用):
 * 静态在前(内置命令带调校过的 action/token,如 /model = 幕布内 picker),
 * 动态按 value 去重后补后 —— 扩展注册命令、磁盘自定义项只增不顶替。
 */
export function mergeSuggestions(
  declared: readonly CliSuggestion[],
  dynamic: readonly CliSuggestion[],
): CliSuggestion[] {
  const seen = new Set(declared.map((s) => s.value));
  return [...declared, ...dynamic.filter((s) => !seen.has(s.value))];
}

async function fetchKind(
  profile: CliProfile,
  kind: "command" | "skill" | "mcp",
  cwd: string,
): Promise<CliSuggestion[]> {
  const provider =
    kind === "mcp"
      ? profile.listMcpServers
      : profile.listSuggestions
        ? (cwd: string) => profile.listSuggestions!(kind, cwd)
        : undefined;
  /* 未声明 provider:mcp = 无此区;command/skill = 走静态表 */
  if (!provider) return [];
  const key = `${profile.id}\0${kind}\0${cwd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;
  let items: CliSuggestion[] | null = null;
  try {
    items = await provider(cwd);
  } catch {
    items = null; /* 失败不缓存,下次重试 */
  }
  if (!items) return [];
  cache.set(key, { at: Date.now(), items });
  return items;
}

function toItems(
  suggestions: readonly CliSuggestion[],
  section: DrawerSection,
  defaultToken: (s: CliSuggestion) => string,
): DrawerItem[] {
  const withIdx = suggestions.map((s, i) => ({ s, i }));
  withIdx.sort((a, b) => (a.s.order ?? a.i) - (b.s.order ?? b.i));
  return withIdx.map(({ s }) => ({
    section,
    name: s.value,
    description: s.description,
    action: s.action ?? "insert",
    icon: s.icon,
    token: s.token ?? defaultToken(s),
  }));
}

/** 静态表 → token 合成规则:命令 "/name ",技能 "$name "(发送时才走 translate)。 */
function staticToken(section: "command" | "skill", s: CliSuggestion): string {
  return section === "command" ? `/${s.value} ` : `$${s.value} `;
}

/** profile 的静态抽屉条目(零 IO,同步)。Composer 两阶段渲染的第一拍:先上静态,动态到达后整体替换。 */
export function staticProfileDrawerItems(profile: CliProfile): DrawerItem[] {
  const items: DrawerItem[] = [];
  for (const kind of ["command", "skill"] as const) {
    if (!profile.triggers.some((t) => t.kind === kind)) continue;
    items.push(...toItems(profile.suggestions?.[kind] ?? [], kind, (s) => staticToken(kind, s)));
  }
  return items;
}

/* ---------- 插件:内核注册表(feature 类),纯函数可测 ---------- */

interface PluginStateLike {
  plugin: { id: string; meta: { name: string; desc: string; category: string } };
  enabled: boolean;
}

export function pluginDrawerItems(
  states: readonly PluginStateLike[],
  panels: readonly { id: string; icon: FilePanelIcon }[],
): DrawerItem[] {
  return states
    .filter((s) => s.enabled && s.plugin.meta.category === "feature")
    .map<DrawerItem>((s) => {
      const panel = panels.find((p) => p.id === s.plugin.id);
      return {
        section: "plugin",
        name: s.plugin.meta.name,
        description: s.plugin.meta.desc,
        action: "open",
        iconNode: panel?.icon,
        panelId: panel?.id,
        openSettings: !panel,
      };
    });
}

/* ---------- 总入口 ---------- */

/** 该 profile 声明了哪些动态 kind(分区派生:命令/技能看 triggers,mcp 看声明)。 */
export function declaredSections(profile: CliProfile): DrawerSection[] {
  const sections: DrawerSection[] = [];
  if (profile.triggers.some((t) => t.kind === "command")) sections.push("command");
  if (profile.triggers.some((t) => t.kind === "skill")) sections.push("skill");
  if (profile.listMcpServers) sections.push("mcp");
  return sections;
}

/**
 * 解析抽屉全部条目(不含 plugin 区 —— 插件与 profile 无关,由调用方拼装,
 * 避免 profile 未变而插件启停变化时吃陈旧缓存)。
 */
export async function resolveProfileDrawerItems(
  profile: CliProfile,
  cwd: string,
): Promise<DrawerItem[]> {
  const items: DrawerItem[] = [];
  for (const kind of ["command", "skill"] as const) {
    if (!profile.triggers.some((t) => t.kind === kind)) continue;
    const dynamic = await fetchKind(profile, kind, cwd);
    items.push(
      ...toItems(mergeSuggestions(profile.suggestions?.[kind] ?? [], dynamic), kind, (s) =>
        staticToken(kind, s),
      ),
    );
  }
  if (profile.listMcpServers) {
    const servers = await fetchKind(profile, "mcp", cwd);
    items.push(...toItems(servers, "mcp", (s) => `$${s.value} `));
  }
  return items;
}

/** 插件区条目(每次实时取内核态)。 */
export function resolvePluginDrawerItems(): DrawerItem[] {
  return pluginDrawerItems(
    host.listPluginStates().map((s) => ({
      plugin: {
        id: s.plugin.id,
        meta: {
          name: s.plugin.meta.name,
          desc: s.plugin.meta.desc,
          category: s.plugin.meta.category,
        },
      },
      enabled: s.enabled,
    })),
    getFilePanels().map((p) => ({ id: p.id, icon: p.icon })),
  );
}
