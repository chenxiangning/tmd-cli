/**
 * 设置字段清洗 —— 自 settings.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:外部数据(JSON/补丁)→ 合法 AppSettings 的全部 sanitize 逻辑;
 * 非法/缺失字段一律回落 settingsTypes.ts 的默认值。store 装配在 settings.ts。
 */

import { sanitizeSshSettings } from "./sshSettings";
import { isThemePresetId, type ThemePresetId } from "./themePresets";
import {
  ASK_SOUND_IDS,
  DEFAULT_SETTINGS,
  SESSION_LIST_TOTAL_DEFAULT,
  SESSION_LIST_TOTAL_MAX,
  SESSION_LIST_TOTAL_MIN,
  type AppSettings,
  type AskSoundId,
  type MemoryCapsuleMode,
  type MemoryDistillEngine,
  type SendShortcut,
  type SessionListBudget,
  type SessionPinEntry,
  type SessionPinScope,
  type ThemePreference,
} from "./settingsTypes";

/** 手动命名覆盖层上限:500 条(超出按 key 序丢弃,确定性兜底);标题 1–200 字符。 */
const SESSION_TITLES_MAX_ENTRIES = 500;
const SESSION_TITLE_MAX_LENGTH = 200;

/** 会话命名清洗:只收非空 key + 非空字符串值,截断超长标题,按 key 序限量纳入。 */
function sanitizeSessionTitles(raw: unknown): Record<string, string> {
  const titles: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return titles;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(titles).length >= SESSION_TITLES_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    titles[key] = trimmed.slice(0, SESSION_TITLE_MAX_LENGTH);
  }
  return titles;
}
/** 置顶层上限:200 条(超出按 key 序丢弃,确定性兜底);标题快照 ≤200 字符(可为空串)。 */
const SESSION_PINS_MAX_ENTRIES = 200;
const SESSION_PIN_SCOPES: readonly SessionPinScope[] = ["global", "workspace"];

/** 置顶清洗:只收合法 scope + 有限非负时间戳的项,标题截断,按 key 序限量纳入。 */
function sanitizeSessionPins(raw: unknown): Record<string, SessionPinEntry> {
  const pins: Record<string, SessionPinEntry> = {};
  if (!raw || typeof raw !== "object") return pins;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(pins).length >= SESSION_PINS_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (!SESSION_PIN_SCOPES.includes(entry.scope as SessionPinScope)) continue;
    const pinnedAt = typeof entry.pinnedAt === "number" ? entry.pinnedAt : Number.NaN;
    if (!Number.isFinite(pinnedAt) || pinnedAt < 0) continue;
    pins[key] = {
      scope: entry.scope as SessionPinScope,
      pinnedAt: Math.floor(pinnedAt),
      title:
        typeof entry.title === "string"
          ? entry.title.trim().slice(0, SESSION_TITLE_MAX_LENGTH)
          : "",
    };
  }
  return pins;
}

/** 工作区折叠态清洗:只收 boolean 值,按 key 序限量纳入(与置顶同款确定性兜底)。 */
function sanitizeWorkspaceCollapsedMap(raw: unknown): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object") return map;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort().slice(0, SESSION_PINS_MAX_ENTRIES)) {
    if (typeof entries[key] === "boolean") map[key] = entries[key] as boolean;
  }
  return map;
}

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark", "custom"];
const SEND_SHORTCUTS: readonly SendShortcut[] = ["enter", "cmdOrCtrlEnter"];

const MEMORY_CAPSULE_MODES: readonly MemoryCapsuleMode[] = ["manual", "auto", "off"];

const MEMORY_DISTILL_ENGINES = ["omp", "pi", "opencode"] as const;

/** 缓冲上限合法域:5万–1000万字符;非法/缺失回落默认。 */
function sanitizeBufferLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) && n >= 50_000 && n <= 10_000_000
    ? Math.floor(n)
    : DEFAULT_SETTINGS.sessionOutputBufferLimit;
}
/**
 * 显示预算清洗:total 越界回落默认;perCli 丢弃非负整数以外的项,
 * 按 key 排序逐项纳入,加入即超 sum ≤ total 的项丢弃(手改 JSON 兜底,确定性)。
 * 已卸载 CLI 的残留 key 不在这里剪(内核不认识注册表),由 session-budget 弹窗
 * 写入时经 budgetCommit.prunePerCli 剪除;读取侧 resolveCliSessionQuota 亦只计注册集。
 */
function sanitizeSessionListBudget(raw: unknown): SessionListBudget {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const totalRaw = typeof obj.total === "number" ? obj.total : Number.NaN;
  const total =
    Number.isFinite(totalRaw) &&
    totalRaw >= SESSION_LIST_TOTAL_MIN &&
    totalRaw <= SESSION_LIST_TOTAL_MAX
      ? Math.floor(totalRaw)
      : SESSION_LIST_TOTAL_DEFAULT;
  const perCli: Record<string, number> = {};
  let allocated = 0;
  if (obj.perCli && typeof obj.perCli === "object") {
    const entries = obj.perCli as Record<string, unknown>;
    for (const key of Object.keys(entries).sort()) {
      const value = entries[key];
      if (!key || typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        continue;
      }
      if (allocated + value > total) continue;
      perCli[key] = value;
      allocated += value;
    }
  }
  return { total, perCli };
}

/** 拔出的插件 id 清洗:仅留非空字符串,去重 + 排序(手改 JSON 兜底,确定性)。 */
function sanitizeDisabledPlugins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && item) ids.add(item);
  }
  return [...ids].sort();
}

/** 网络代理地址长度上限(env 注入侧的确定性兜底)。 */
const NETWORK_PROXY_URL_MAX_LENGTH = 500;

/**
 * 代理地址清洗:trim + 去 C0 控制字符 + 截断。不做格式校验 ——
 * 用户可见的格式校验归 network-proxy 插件编辑器,Rust proxy.rs 另有兜底。
 */
function sanitizeNetworkProxyUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, NETWORK_PROXY_URL_MAX_LENGTH);
}

/** 外部数据 → 合法 AppSettings;非法/缺失字段回落默认值。 */
export function sanitize(raw: unknown): AppSettings {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const theme = THEME_PREFERENCES.includes(obj.theme as ThemePreference)
    ? (obj.theme as ThemePreference)
    : DEFAULT_SETTINGS.theme;
  return {
    theme,
    lightThemePresetId: isThemePresetId(obj.lightThemePresetId as string)
      ? (obj.lightThemePresetId as ThemePresetId)
      : DEFAULT_SETTINGS.lightThemePresetId,
    darkThemePresetId: isThemePresetId(obj.darkThemePresetId as string)
      ? (obj.darkThemePresetId as ThemePresetId)
      : DEFAULT_SETTINGS.darkThemePresetId,
    customThemePresetId: isThemePresetId(obj.customThemePresetId as string)
      ? (obj.customThemePresetId as ThemePresetId)
      : DEFAULT_SETTINGS.customThemePresetId,
    sessionTabsEnabled:
      typeof obj.sessionTabsEnabled === "boolean"
        ? obj.sessionTabsEnabled
        : DEFAULT_SETTINGS.sessionTabsEnabled,
    sendShortcut: SEND_SHORTCUTS.includes(obj.sendShortcut as SendShortcut)
      ? (obj.sendShortcut as SendShortcut)
      : DEFAULT_SETTINGS.sendShortcut,
    askSoundEnabled:
      typeof obj.askSoundEnabled === "boolean"
        ? obj.askSoundEnabled
        : DEFAULT_SETTINGS.askSoundEnabled,
    askSoundId: ASK_SOUND_IDS.includes(obj.askSoundId as AskSoundId)
      ? (obj.askSoundId as AskSoundId)
      : DEFAULT_SETTINGS.askSoundId,
    turnEndSoundEnabled:
      typeof obj.turnEndSoundEnabled === "boolean"
        ? obj.turnEndSoundEnabled
        : DEFAULT_SETTINGS.turnEndSoundEnabled,
    turnEndSoundId: ASK_SOUND_IDS.includes(obj.turnEndSoundId as AskSoundId)
      ? (obj.turnEndSoundId as AskSoundId)
      : DEFAULT_SETTINGS.turnEndSoundId,
    backgroundNotify:
      typeof obj.backgroundNotify === "boolean"
        ? obj.backgroundNotify
        : DEFAULT_SETTINGS.backgroundNotify,
    sessionOutputBufferLimit: sanitizeBufferLimit(obj.sessionOutputBufferLimit),
    sessionListBudget: sanitizeSessionListBudget(obj.sessionListBudget),
    disabledPlugins: sanitizeDisabledPlugins(obj.disabledPlugins),
    sessionTitles: sanitizeSessionTitles(obj.sessionTitles),
    sessionPins: sanitizeSessionPins(obj.sessionPins),
    workspaceCollapsedMap: sanitizeWorkspaceCollapsedMap(obj.workspaceCollapsedMap),
    // 同形 Record<string, boolean>,清洗语义与工作区折叠键完全一致
    workspaceGroupCollapsedMap: sanitizeWorkspaceCollapsedMap(
      obj.workspaceGroupCollapsedMap,
    ),
    networkProxyEnabled:
      typeof obj.networkProxyEnabled === "boolean"
        ? obj.networkProxyEnabled
        : DEFAULT_SETTINGS.networkProxyEnabled,
    networkProxyUrl: sanitizeNetworkProxyUrl(obj.networkProxyUrl),
    memoryDbPath: typeof obj.memoryDbPath === "string" ? obj.memoryDbPath.slice(0, 500) : "",
    memoryEnabled: typeof obj.memoryEnabled === "boolean" ? obj.memoryEnabled : true,
    memoryCapsuleMode: MEMORY_CAPSULE_MODES.includes(obj.memoryCapsuleMode as MemoryCapsuleMode)
      ? (obj.memoryCapsuleMode as MemoryCapsuleMode)
      : "manual",
    memoryAutoDistill: typeof obj.memoryAutoDistill === "boolean" ? obj.memoryAutoDistill : false,
    memoryDistillModel: typeof obj.memoryDistillModel === "string" ? obj.memoryDistillModel.slice(0, 200) : "",
    memoryDistillEngine: (MEMORY_DISTILL_ENGINES as readonly string[]).includes(obj.memoryDistillEngine as string)
      ? (obj.memoryDistillEngine as MemoryDistillEngine)
      : "omp",
    memoryDistillRules: typeof obj.memoryDistillRules === "string" ? obj.memoryDistillRules.slice(0, 500) : "",
    ssh: sanitizeSshSettings(obj.ssh),
  };
}
