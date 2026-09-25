/**
 * 全局设置 store —— AppSettings 的唯一事实源。
 *
 * 持久化:`~/.tmd-cli/settings.json`(Rust config_read/write_settings 透传 Value,
 * schema/默认值/sanitize 全部在前端,见 src-tauri/src/settings.rs 的设计决策)。
 * 浏览器 dev(无 Tauri runtime)降级 localStorage,保证 vite 起得来。
 *
 * 模式与 kernel/workspace.ts 一致:模块级 state + useSyncExternalStore;
 * 面板开关态(设置领域 UI 态)也在此,不放 host。
 * 规模铁则拆分:类型/默认值在 settingsTypes.ts,清洗在 settingsSanitize.ts。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "./ipc";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { AppSettings } from "./settingsTypes";
import { sanitize } from "./settingsSanitize";
import { advanceBaseline, mergeDiskIntoPayload, setDiskBaseline } from "./settingsPersistMerge";
import { setShortcutOverrides } from "./shortcutOverrides";
import { isWeb, listen } from "./transport";
/** 订阅设置写盘失败(Tauri 环境触发;SettingsPersistToast 订阅呈现);返回退订。 */
const persistFailListeners = new Set<(error: string) => void>();
export function onSettingsPersistFailed(cb: (error: string) => void): () => void {
  persistFailListeners.add(cb);
  return () => persistFailListeners.delete(cb);
}
export * from "./settingsTypes";
export * from "./settingsAppearance";
export * from "./settingsRelayHistory";
interface SettingsState {
  settings: AppSettings;
  /** 首屏落地前为 false,主题引擎等它再应用(防闪默认色)。 */
  loaded: boolean;
  panelOpen: boolean;
  /** 深链:开面板指定 section/tab(openSettingsPanel(target));null = 保持上次位置 */
  panelTarget: { section: string; tab?: string } | null;
}

/** 浏览器 dev 降级存储 key(Tauri 环境不走这里)。 */
const LOCAL_FALLBACK_KEY = "tmd.settings.v1";

const state: SettingsState = {
  settings: DEFAULT_SETTINGS,
  loaded: false,
  panelOpen: false, panelTarget: null,
};
const listeners = new Set<() => void>();
let snapshot: SettingsState = state;

function emit(): void {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

/** 待落盘补丁:自上次写盘起 updateSettings 触碰过的顶层域并集。
 *  写盘只上送这些域 —— 整树覆盖写会把 Rust 直写盘(web_relay 回填
 *  webAccessEnabled)与他实例刚落的键砸回内存旧值(00d3dc5「绿灯但桥死」),
 *  补丁写让陈旧域根本不上线,该竞态从机制上消失。 */
let pendingPatch: Partial<AppSettings> = {};

/** persist 串行链:并发交错的读盘→合并→写盘可能乱序落盘(后发先至会用陈旧
 *  盘像复活已删标记),链式排队保证基线推进与写序一致。persistNow 永不 reject。 */
let persistChain: Promise<void> = Promise.resolve();

function persist(): void {
  persistChain = persistChain.then(persistNow);
}

async function persistNow(): Promise<void> {
  const memory = state.settings;
  const patch = pendingPatch;
  pendingPatch = {};
  try {
    /* 标记域(归档/置顶等)仍整域拉盘合并:双实例丢更新防护(2026-09-11 实证)
       与删除意图判定(diskBaseline)是域内语义,补丁写不改变它们 —— 只是合并
       结果仅在被触碰时才上送。盘不可读(他实例锁文件等)按本实例状态原样写。 */
    let full = memory;
    try {
      full = mergeDiskIntoPayload(memory, await ipc.configReadSettings());
    } catch {
      /* 按内存原样 */
    }
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      payload[key] = (full as unknown as Record<string, unknown>)[key];
    }
    await ipc.configMergeSettings(payload);
    advanceBaseline(memory, full);
  } catch (err) {
    /* 写盘失败:补丁返还(与期间新补丁合并,新者胜),下轮 persist 重试。 */
    pendingPatch = { ...patch, ...pendingPatch };
    // 浏览器 dev:降级 localStorage
    try {
      localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(memory));
      setDiskBaseline(memory);
    } catch (err2) {
      console.warn("settings: 持久化失败", err2);
    }
    /* Tauri 环境写盘失败必须可见:盘上旧文件完好 → 重启回读旧值,
       localStorage 兜底永远不生效,改动静默丢失。轻量监听注册面
       (SettingsPersistToast 订阅);不 import host——那条链会把他测
       的 persist 失败放大成整张 host 图加载(2026-09-20 实证拖爆测试)。 */
    if (!isWeb) {
      for (const cb of persistFailListeners) cb(String(err));
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
  setDiskBaseline(state.settings);
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
  hookSettingsChanged();
}

/** 合并补丁并持久化。唯一写入口。 */
export function updateSettings(patch: Partial<AppSettings>): void {
  state.settings = sanitize({ ...state.settings, ...patch });
  pendingPatch = { ...pendingPatch, ...patch };
  setShortcutOverrides(state.settings.shortcutOverrides);
  emit();
  void persist();
}

/** Rust 侧直写盘(如 web_relay_start 回填 webAccessEnabled)后 emit 此事件,store 回读对齐。 */
let settingsChangedHooked = false;

function hookSettingsChanged(): void {
  if (settingsChangedHooked) return;
  settingsChangedHooked = true;
  if (typeof window === "undefined") return; // 测试环境无 window,跳过
  void listen("settings:changed", () => {
    void load();
  });
}

export function openSettingsPanel(target?: { section: string; tab?: string }): void {
  if (state.panelOpen && !target) return;
  state.panelOpen = true;
  state.panelTarget = target ?? null;
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
