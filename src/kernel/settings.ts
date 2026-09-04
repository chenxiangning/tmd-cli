/**
 * 全局设置 store —— AppSettings 的唯一事实源。
 *
 * 持久化:`~/.tmd-cli/settings.json`(Rust config_read/write_settings 透传 Value,
 * schema/默认值/sanitize 全部在本文件,见 src-tauri/src/settings.rs 的设计决策)。
 * 浏览器 dev(无 Tauri runtime)降级 localStorage,保证 vite 起得来。
 *
 * 模式与 kernel/workspace.ts 一致:模块级 state + useSyncExternalStore。
 * 面板开关态(settingsPanelOpen)也在此:它是设置领域的 UI 态,不放 host。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "./ipc";
import type { SshHostConfig } from "./sshTypes";
import { sanitizeSshSettings } from "./sshSettings";
import {
  DEFAULT_DARK_THEME_PRESET_ID,
  DEFAULT_LIGHT_THEME_PRESET_ID,
  isThemePresetId,
  type ThemePresetId,
} from "./themePresets";

export type ThemePreference = "system" | "light" | "dark" | "custom";
/** 发送快捷键:"enter" = Enter 发送 / Shift+Enter 换行;"cmdOrCtrlEnter" = ⌘/Ctrl+Enter 发送 / Enter 换行。 */
export type SendShortcut = "enter" | "cmdOrCtrlEnter";
/** Ask 提示音效 id(内置 wav 资产,见 kernel/askSound.ts 加载器)。 */
export type AskSoundId = "default" | "chime" | "bell" | "ding";
/** Ask 提示音效白名单(清洗与播放共用)。 */
export const ASK_SOUND_IDS: readonly AskSoundId[] = ["default", "chime", "bell", "ding"];

/**
 * 工作区会话列表显示预算(参考 codemoss 工作区设置,改为预算分配语义):
 * 总数 total 是一个工作区内所有 CLI 分组共享的初始露出条数;
 * perCli 按 CLI 预留配额,不变式 sum(perCli) ≤ total;
 * 未配置的 CLI 均分剩余(见 resolveCliSessionQuota)。
 */
export interface SessionListBudget {
  /** 初始露出的磁盘历史总条数(所有 CLI 分组共享)。 */
  total: number;
  /** 按 CLI 预留的条数;缺省的 CLI 均分剩余。 */
  perCli: Record<string, number>;
}

/** 显示总数合法域:1–100,默认 20(4 个 CLI 均分 ≈ 每组 5 条)。 */
const SESSION_LIST_TOTAL_DEFAULT = 20;
export const SESSION_LIST_TOTAL_MIN = 1;
export const SESSION_LIST_TOTAL_MAX = 100;

/**
 * 解析某 CLI 分组的初始露出条数。
 * 已配置 = 配额原值(可为 0:该组初始不露出历史,仅活会话 + 「更多...」);
 * 未配置 = floor(剩余预算 / 未配置 CLI 数),可整除尽,剩余尾数不补。
 * registeredCliIds 由调用方给(内核不认识 CLI 注册表)。
 * 已分配只计注册集内 key:已卸载 CLI 的残留 perCli 不抬高占用
 * (与 session-budget 的 prunePerCli 同不变式)。
 */
export function resolveCliSessionQuota(
  budget: SessionListBudget,
  cliId: string,
  registeredCliIds: readonly string[],
): number {
  const explicit = budget.perCli[cliId];
  if (explicit !== undefined) return explicit;
  const allocated = registeredCliIds.reduce(
    (sum, id) => sum + (budget.perCli[id] ?? 0),
    0,
  );
  const unallocatedCount = registeredCliIds.filter(
    (id) => budget.perCli[id] === undefined,
  ).length;
  if (unallocatedCount === 0) return 0;
  return Math.max(0, Math.floor((budget.total - allocated) / unallocatedCount));
}

/** 置顶作用域:"global" = 左侧栏全局置顶区;"workspace" = 工作区 CLI 分组内顶部。 */
export type SessionPinScope = "global" | "workspace";

/** 单条置顶记录:作用域 + 置顶时间戳(ms) + 标题快照。 */
export interface SessionPinEntry {
  scope: SessionPinScope;
  pinnedAt: number;
  title: string;
}

export interface AppSettings {
  theme: ThemePreference;
  /** 浅色外观使用的 preset(system/light 模式生效)。 */
  lightThemePresetId: ThemePresetId;
  /** 深色外观使用的 preset(system/dark 模式生效)。 */
  darkThemePresetId: ThemePresetId;
  /** 自定义模式当前 preset。 */
  customThemePresetId: ThemePresetId;
  /** 顶栏中央会话标题 tab 条开关(外观页可调,默认开启;见 kernel/sessionTabs.ts)。 */
  sessionTabsEnabled: boolean;
  /** Composer 发送快捷键行为。 */
  sendShortcut: SendShortcut;
  /** Ask/确认面板提示音开关(行为页可调,默认开启)。 */
  askSoundEnabled: boolean;
  /** Ask 提示音效 id。 */
  askSoundId: AskSoundId;
  /** 对话轮次结束(未被查看)提示音开关,默认开启。 */
  turnEndSoundEnabled: boolean;
  /** 轮次结束提示音效 id(与 Ask 音共用内置 wav 白名单)。 */
  turnEndSoundId: AskSoundId;
  /** 后台提醒:窗口失焦时激活会话完成一轮也视为未查看(标蓝 + 结束音)。 */
  backgroundNotify: boolean;
    /** 单会话输出环形缓冲上限(字符);切回会话的回放深度由它决定,更早历史走幕布翻页。 */
  sessionOutputBufferLimit: number;
  /** 工作区会话列表显示预算(总数 + 按 CLI 配额)。 */
  sessionListBudget: SessionListBudget;
  /** 插件市场"拔出"的插件 id 列表;重启后 activateAll 跳过(插拔语义 = 重启生效)。 */
  disabledPlugins: string[];
  /**
   * 会话手动命名覆盖层:key = `${profileId}:${cliSessionId}`,value = 用户起的标题。
   * 显示优先级:此覆盖 > CLI 磁盘原生标题 > 首条用户消息 > 短 id。
   * 统一走应用侧而非写回 CLI 磁盘文件:omp/pi 的 title 记录是定长 pad 覆写格式,
   * claude/codex 无原生 rename 概念,改写他人私有格式有解析破坏风险(架构决策见 docs/architecture)。
   */
  sessionTitles: Record<string, string>;
  /**
   * 会话置顶层(codemoss 双作用域置顶复刻):key = `${workspaceId}:${profileId}:${cliSessionId}`。
   * - scope "global":会话离开工作区分组,汇入左侧栏顶部「已置顶」全局区;
   * - scope "workspace":会话固定在其 CLI 分组顶部,不参与磁盘历史分页。
   * 两作用域互斥由单 map 结构保证(一个 key 同时只属于一个 scope);
   * title 为置顶时刻的标题快照,供全局区免磁盘扫描直接显示(手动命名覆盖层优先于快照)。
   */
  sessionPins: Record<string, SessionPinEntry>;
  /**
   * 左侧栏各工作区会话列表折叠态:key = workspaceId,value = 是否折叠。
   * 缺失的工作区(首次出现)默认折叠;切换折叠/展开与「折叠全部」均写这里,
   * 重启后恢复上次状态。
   */
  workspaceCollapsedMap: Record<string, boolean>;
  /**
   * 网络代理(network-proxy 插件的编辑域):客户端自身联网(quota_fetch 等
   * Rust reqwest 请求、installer 的 curl/npm 子进程)与之后 spawn 的 PTY CLI
   * 子进程统一走该代理。生效在 Rust 侧 proxy.rs(进程 env 注入,启动 + 写盘
   * 两个时机),前端只持数值。已在跑的旧会话不受影响,需手动重启。
   */
  networkProxyEnabled: boolean;
  /** 代理地址,http(s)://host:port 或 socks5://host:port;关闭时保留以便重开。 */
  networkProxyUrl: string;
  /**
   * SSH 主机簿(ssh 插件的编辑域):终端/SFTP/端口转发共用的主机清单。
   * 凭据明文随 settings.json 落盘(用户裁决,与竞品同级;spec 已记录风险),
   * Web/远端场景不存在 —— 单机应用,不经任何同步通道外发。
   */
  ssh: { hosts: SshHostConfig[] };
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  lightThemePresetId: DEFAULT_LIGHT_THEME_PRESET_ID,
  darkThemePresetId: DEFAULT_DARK_THEME_PRESET_ID,
  customThemePresetId: DEFAULT_DARK_THEME_PRESET_ID,
  sessionTabsEnabled: true,
  sendShortcut: "enter",
  askSoundEnabled: true,
  askSoundId: "default",
  turnEndSoundEnabled: true,
  turnEndSoundId: "default",
  backgroundNotify: true,
  sessionOutputBufferLimit: 500_000,
  sessionListBudget: { total: SESSION_LIST_TOTAL_DEFAULT, perCli: {} },
  disabledPlugins: [],
  sessionTitles: {},
  sessionPins: {},
  workspaceCollapsedMap: {},
  networkProxyEnabled: false,
  networkProxyUrl: "",
  ssh: { hosts: [] },
};
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

/** 浏览器 dev 降级存储 key(Tauri 环境不走这里)。 */
const LOCAL_FALLBACK_KEY = "tmd.settings.v1";

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark", "custom"];
const SEND_SHORTCUTS: readonly SendShortcut[] = ["enter", "cmdOrCtrlEnter"];

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
function sanitize(raw: unknown): AppSettings {
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
    networkProxyEnabled:
      typeof obj.networkProxyEnabled === "boolean"
        ? obj.networkProxyEnabled
        : DEFAULT_SETTINGS.networkProxyEnabled,
    networkProxyUrl: sanitizeNetworkProxyUrl(obj.networkProxyUrl),
    ssh: sanitizeSshSettings(obj.ssh),
  };
}

interface SettingsState {
  settings: AppSettings;
  /** 首屏落地前为 false,主题引擎等它再应用(防闪默认色)。 */
  loaded: boolean;
  panelOpen: boolean;
}

const state: SettingsState = {
  settings: DEFAULT_SETTINGS,
  loaded: false,
  panelOpen: false,
};
const listeners = new Set<() => void>();
let snapshot: SettingsState = state;

function emit(): void {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

async function persist(): Promise<void> {
  try {
    await ipc.configWriteSettings(state.settings);
  } catch {
    // 浏览器 dev:降级 localStorage
    try {
      localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(state.settings));
    } catch (err) {
      console.warn("settings: 持久化失败", err);
    }
  }
}

async function load(): Promise<void> {
  let raw: unknown = null;
  try {
    raw = await ipc.configReadSettings();
  } catch {
    try {
      raw = JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) ?? "null");
    } catch {
      raw = null;
    }
  }
  state.settings = sanitize(raw);
  state.loaded = true;
  emit();
}

let booted = false;
/** 启动时调用一次(main.tsx);幂等。 */
/** 首载完成的 Promise:host.activateAll 等它再按 disabledPlugins 过滤(否则过滤读到的是默认值)。 */
export let settingsReady: Promise<void> = Promise.resolve();

export function ensureSettingsBooted(): void {
  if (booted) return;
  booted = true;
  settingsReady = load();
}

/** 合并补丁并持久化。唯一写入口。 */
export function updateSettings(patch: Partial<AppSettings>): void {
  state.settings = sanitize({ ...state.settings, ...patch });
  emit();
  void persist();
}

export function openSettingsPanel(): void {
  if (state.panelOpen) return;
  state.panelOpen = true;
  emit();
}

export function closeSettingsPanel(): void {
  if (!state.panelOpen) return;
  state.panelOpen = false;
  emit();
}

export function useSettingsState(): SettingsState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

/** 非 React 读取(主题引擎等命令式消费者)。 */
export function getSettingsState(): SettingsState {
  return snapshot;
}

/** 非 React 订阅;返回退订函数。 */
export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
