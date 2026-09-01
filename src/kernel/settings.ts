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
import {
  DEFAULT_DARK_THEME_PRESET_ID,
  DEFAULT_LIGHT_THEME_PRESET_ID,
  isThemePresetId,
  type ThemePresetId,
} from "./themePresets";

export type ThemePreference = "system" | "light" | "dark" | "custom";
/** 发送快捷键:"enter" = Enter 发送 / Shift+Enter 换行;"cmdOrCtrlEnter" = ⌘/Ctrl+Enter 发送 / Enter 换行。 */
export type SendShortcut = "enter" | "cmdOrCtrlEnter";

export interface AppSettings {
  theme: ThemePreference;
  /** 浅色外观使用的 preset(system/light 模式生效)。 */
  lightThemePresetId: ThemePresetId;
  /** 深色外观使用的 preset(system/dark 模式生效)。 */
  darkThemePresetId: ThemePresetId;
  /** 自定义模式当前 preset。 */
  customThemePresetId: ThemePresetId;
  /** Composer 发送快捷键行为。 */
  sendShortcut: SendShortcut;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  lightThemePresetId: DEFAULT_LIGHT_THEME_PRESET_ID,
  darkThemePresetId: DEFAULT_DARK_THEME_PRESET_ID,
  customThemePresetId: DEFAULT_DARK_THEME_PRESET_ID,
  sendShortcut: "enter",
};

/** 浏览器 dev 降级存储 key(Tauri 环境不走这里)。 */
const LOCAL_FALLBACK_KEY = "tmd.settings.v1";

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark", "custom"];
const SEND_SHORTCUTS: readonly SendShortcut[] = ["enter", "cmdOrCtrlEnter"];

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
    sendShortcut: SEND_SHORTCUTS.includes(obj.sendShortcut as SendShortcut)
      ? (obj.sendShortcut as SendShortcut)
      : DEFAULT_SETTINGS.sendShortcut,
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
export function ensureSettingsBooted(): void {
  if (booted) return;
  booted = true;
  void load();
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
