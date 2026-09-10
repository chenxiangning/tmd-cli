/**
 * 设置字段清洗 —— 自 settings.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:外部数据(JSON/补丁)→ 合法 AppSettings 的全部 sanitize 逻辑;
 * 非法/缺失字段一律回落 settingsTypes.ts 的默认值。store 装配在 settings.ts。
 */

import { sanitizeSshSettings } from "./sshSettings";
import { isThemePresetId, type ThemePresetId } from "./themePresets";
import {
  UI_LANGUAGES,
  sanitizeTerminalFontFamily,
  sanitizeTerminalFontSize,
  sanitizeUiFontSize,
  sanitizeSessionTabsMax,
  sanitizeUiZoom,
  sanitizeIconDecor,
  type UiLanguage,
} from "./settingsAppearance";
import {
  ASK_SOUND_IDS,
  DEFAULT_SETTINGS,
  SESSION_LIST_TOTAL_DEFAULT,
  SESSION_LIST_TOTAL_MAX,
  SESSION_LIST_TOTAL_MIN,
  type AppSettings,
  type AskSoundId,
  type GitDiffMode,
  type GitFileListLayout,
  type GitPanelView,
  type MemoryCapsuleMode,
  type SendShortcut,
  type SessionListBudget,
  type ThemePreference,
  type WorkspaceGroup,
} from "./settingsTypes";
import {
  sanitizeSessionArchive,
  sanitizeSessionDeleted,
  sanitizeSessionPins,
  sanitizeSessionTitles,
} from "./settingsSanitizeSessions";
import { sanitizeShortcutOverrides } from "./settingsSanitizeShortcuts";

/** 工作区折叠图上限(与置顶/归档同款确定性兜底口径)。 */
const WORKSPACE_COLLAPSED_MAX_ENTRIES = 200;

/** 工作区折叠态清洗:只收 boolean 值,按 key 序限量纳入(与置顶同款确定性兜底)。 */
function sanitizeWorkspaceCollapsedMap(raw: unknown): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object") return map;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort().slice(0, WORKSPACE_COLLAPSED_MAX_ENTRIES)) {
    if (typeof entries[key] === "boolean") map[key] = entries[key] as boolean;
  }
  return map;
}

/** 分组清单上限(与折叠图同款确定性兜底口径)。 */
const WORKSPACE_GROUPS_MAX = 100;

/** 工作区分组清洗:id/name 须为非空字符串,name trim 后为空丢弃,超长截断。 */
function sanitizeWorkspaceGroups(raw: unknown): WorkspaceGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: WorkspaceGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (groups.length >= WORKSPACE_GROUPS_MAX) break;
    if (!item || typeof item !== "object") continue;
    const { id, name } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    seen.add(id);
    groups.push({ id, name: name.trim().slice(0, 60) });
  }
  return groups;
}

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark", "custom"];
const SEND_SHORTCUTS: readonly SendShortcut[] = ["enter", "cmdOrCtrlEnter"];

const MEMORY_CAPSULE_MODES: readonly MemoryCapsuleMode[] = ["manual", "auto", "off"];

const GIT_PANEL_VIEWS: readonly GitPanelView[] = ["diff", "branch", "history"];
const GIT_PANEL_LAYOUTS: readonly GitFileListLayout[] = ["flat", "tree"];
const GIT_DIFF_MODES: readonly GitDiffMode[] = ["unified", "split"];

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

/** 本地插件信任表清洗:id → 非空字符串数组;坏 id/坏项丢弃,确定性按 key 序。 */
function sanitizeLocalPluginTrust(raw: unknown): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object") return map;
  const entries = raw as Record<string, unknown>;
  for (const id of Object.keys(entries).sort()) {
    if (!id || !Array.isArray(entries[id])) continue;
    const hashes = [
      ...new Set(
        (entries[id] as unknown[]).filter(
          (h): h is string => typeof h === "string" && h.length > 0,
        ),
      ),
    ];
    if (hashes.length > 0) map[id] = hashes;
  }
  return map;
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

/** Git 面板记忆态清洗:视图/布局/diff 模式白名单外的值逐项回落默认。 */
function sanitizeGitPanel(raw: unknown): AppSettings["git"] {
  const d = DEFAULT_SETTINGS.git;
  if (!raw || typeof raw !== "object") return d;
  // 同 sanitize():外部 JSON 收窄为索引面,逐字段白名单校验后才取值
  const rec = raw as Record<string, unknown>;
  return {
    view: GIT_PANEL_VIEWS.includes(rec.view as GitPanelView) ? (rec.view as GitPanelView) : d.view,
    layout: GIT_PANEL_LAYOUTS.includes(rec.layout as GitFileListLayout)
      ? (rec.layout as GitFileListLayout)
      : d.layout,
    diffMode: GIT_DIFF_MODES.includes(rec.diffMode as GitDiffMode)
      ? (rec.diffMode as GitDiffMode)
      : d.diffMode,
  };
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
    language: UI_LANGUAGES.includes(obj.language as UiLanguage)
      ? (obj.language as UiLanguage)
      : "zh",
    terminalFontSize: sanitizeTerminalFontSize(obj.terminalFontSize),
    terminalFontFamily: sanitizeTerminalFontFamily(obj.terminalFontFamily),
    uiFontSize: sanitizeUiFontSize(obj.uiFontSize),
    uiZoom: sanitizeUiZoom(obj.uiZoom),
    iconDecor: sanitizeIconDecor(obj.iconDecor),
    sessionTabsEnabled:
      typeof obj.sessionTabsEnabled === "boolean"
        ? obj.sessionTabsEnabled
        : DEFAULT_SETTINGS.sessionTabsEnabled,
    sessionTabsMax: sanitizeSessionTabsMax(obj.sessionTabsMax),
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
    promptHistoryEnabled:
      typeof obj.promptHistoryEnabled === "boolean"
        ? obj.promptHistoryEnabled
        : DEFAULT_SETTINGS.promptHistoryEnabled,
    backgroundNotify:
      typeof obj.backgroundNotify === "boolean"
        ? obj.backgroundNotify
        : DEFAULT_SETTINGS.backgroundNotify,
    sessionOutputBufferLimit: sanitizeBufferLimit(obj.sessionOutputBufferLimit),
    sessionListBudget: sanitizeSessionListBudget(obj.sessionListBudget),
    disabledPlugins: sanitizeDisabledPlugins(obj.disabledPlugins),
    localPluginsDisabled: obj.localPluginsDisabled === true,
    localPluginTrust: sanitizeLocalPluginTrust(obj.localPluginTrust),
    sessionTitles: sanitizeSessionTitles(obj.sessionTitles),
    sessionPins: sanitizeSessionPins(obj.sessionPins),
    sessionArchive: sanitizeSessionArchive(obj.sessionArchive),
    sessionDeleted: sanitizeSessionDeleted(obj.sessionDeleted),
    shortcutOverrides: sanitizeShortcutOverrides(obj.shortcutOverrides),
    workspaceArchiveView:
      typeof obj.workspaceArchiveView === "boolean"
        ? obj.workspaceArchiveView
        : DEFAULT_SETTINGS.workspaceArchiveView,
    workspaceCollapsedMap: sanitizeWorkspaceCollapsedMap(obj.workspaceCollapsedMap),
    workspaceGroups: sanitizeWorkspaceGroups(obj.workspaceGroups),
    workspaceGroupCollapsedMap: sanitizeWorkspaceCollapsedMap(obj.workspaceGroupCollapsedMap),
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
    memoryDistillEngine:
      typeof obj.memoryDistillEngine === "string" ? obj.memoryDistillEngine.slice(0, 40) : "",
    memoryDistillRules: typeof obj.memoryDistillRules === "string" ? obj.memoryDistillRules.slice(0, 500) : "",
    ssh: sanitizeSshSettings(obj.ssh),
    git: sanitizeGitPanel(obj.git),
  };
}
