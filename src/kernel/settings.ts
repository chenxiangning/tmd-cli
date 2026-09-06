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
import { sanitize } from "./settingsSanitize";
import { DEFAULT_SETTINGS, type AppSettings } from "./settingsTypes";

export * from "./settingsTypes";

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
