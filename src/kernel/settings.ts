/**
 * 全局设置 store —— AppSettings 的唯一事实源。
 *
 * 持久化:`~/.tmd-cli/settings.json`(Rust config_read/write_settings 透传 Value,
 * schema/默认值/sanitize 全部在前端,见 src-tauri/src/settings.rs 的设计决策)。
 * 浏览器 dev(无 Tauri runtime)降级 localStorage,保证 vite 起得来。
 *
 * 模式与 kernel/workspace.ts 一致:模块级 state + useSyncExternalStore。
 * 面板开关态(settingsPanelOpen)也在此:它是设置领域的 UI 态,不放 host。
 *
 * 文件规模铁则拆分:类型/默认值/配额解析在 settingsTypes.ts(此处 re-export,
 * import 契约不变),字段清洗在 settingsSanitize.ts,本文件只留 store 装配。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "./ipc";
import { DEFAULT_SETTINGS, type AppSettings } from "./settingsTypes";
import { sanitize } from "./settingsSanitize";
import { setShortcutOverrides } from "./shortcutOverrides";

export * from "./settingsTypes";
export * from "./settingsAppearance";

interface SettingsState {
  settings: AppSettings;
  /** 首屏落地前为 false,主题引擎等它再应用(防闪默认色)。 */
  loaded: boolean;
  panelOpen: boolean;
}

/** 浏览器 dev 降级存储 key(Tauri 环境不走这里)。 */
const LOCAL_FALLBACK_KEY = "tmd.settings.v1";

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

type RecordLike = Record<string, Record<string, unknown>>;

/** 带 ts 的记录字段:同 key 冲突取时间戳较新者。 */
const MERGE_TS_FIELDS = {
  sessionArchive: "archivedAt",
  sessionDeleted: "deletedAt",
  sessionPins: "pinnedAt",
} as const;

/** 无 ts 的记录字段:并集,本实例值优先。 */
const MERGE_PLAIN_FIELDS = [
  "sessionTitles",
  "workspaceCollapsedMap",
  "workspaceGroupCollapsedMap",
  "localPluginTrust",
] as const;

/** per-key 合并:盘上条目全收,本实例 key 覆盖(带 ts 时较新者胜)。 */
function mergeEntries(memory: RecordLike, disk: RecordLike, tsField: string | null): RecordLike {
  const out: RecordLike = { ...disk };
  for (const key of Object.keys(memory)) {
    const mine = memory[key];
    const theirs = out[key];
    if (theirs === undefined || tsField === null) {
      out[key] = mine;
      continue;
    }
    const a = typeof mine[tsField] === "number" ? (mine[tsField] as number) : -1;
    const b = typeof theirs[tsField] === "number" ? (theirs[tsField] as number) : -1;
    if (a >= b) out[key] = mine;
  }
  return out;
}

/**
 * 双实例丢更新防护:dev 版与打包版可能并存(2026-09-11 实证),共享
 * settings.json 且写盘是全文件覆盖、后写者赢 —— 陈旧实例一次写盘即抹掉
 * 另一实例刚写的归档/置顶等标记(表现为「归档无效且无提示」)。persist
 * 前拉盘上最新做记录层合并:标记类字段按 key 并集,标量仍以本实例为准。
 * 残留缝:他实例的取消归档/取消置顶会被本实例陈旧内存复活(根除需
 * tombstone,量级不值, ponytail: 出现再补)。合并只作用于写盘 payload,
 * 不回写内存态 —— 他窗标记不实时串进本窗,重载生效。
 */
function mergeDiskIntoPayload(memory: AppSettings, raw: unknown): AppSettings {
  const disk = sanitize(raw);
  const out = { ...memory } as unknown as Record<string, unknown>;
  for (const [field, tsField] of Object.entries(MERGE_TS_FIELDS)) {
    out[field] = mergeEntries(
      memory[field as keyof AppSettings] as unknown as RecordLike,
      disk[field as keyof AppSettings] as unknown as RecordLike,
      tsField,
    );
  }
  for (const field of MERGE_PLAIN_FIELDS) {
    out[field] = mergeEntries(
      memory[field] as unknown as RecordLike,
      disk[field] as unknown as RecordLike,
      null,
    );
  }
  return out as unknown as AppSettings;
}

async function persist(): Promise<void> {
  try {
    let payload = state.settings;
    try {
      payload = mergeDiskIntoPayload(state.settings, await ipc.configReadSettings());
    } catch {
      /* 盘不可读(他实例锁文件等):按本实例状态原样写,行为同旧 */
    }
    await ipc.configWriteSettings(payload);
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
  setShortcutOverrides(state.settings.shortcutOverrides);
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
  setShortcutOverrides(state.settings.shortcutOverrides);
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
