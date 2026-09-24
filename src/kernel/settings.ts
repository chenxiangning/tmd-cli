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

interface SettingsState {
  settings: AppSettings;
  /** 首屏落地前为 false,主题引擎等它再应用(防闪默认色)。 */
  loaded: boolean;
  panelOpen: boolean;
  /** 深链:开面板时指定 section/tab(openSettingsPanel(target));null = 保持面板内上次位置。 */
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

type RecordLike = Record<string, Record<string, unknown>>;

/** 带 ts 的记录字段:同 key 冲突取时间戳较新者。 */
const MERGE_TS_FIELDS = {
  sessionArchive: "archivedAt",
  sessionDeleted: "deletedAt",
  sessionKeep: "keptAt",
  sessionPins: "pinnedAt",
  engineVersionFavs: "favedAt",
} as const;

/** 无 ts 的记录字段:并集,本实例值优先。 */
const MERGE_PLAIN_FIELDS = [
  "sessionTitles",
  "workspaceCollapsedMap",
  "workspaceGroupCollapsedMap",
  "localPluginTrust",
] as const;

/** 键序无关的等值比较(合并后 JSON 键序会漂移,不能拿 stringify 判「未改动」)。 */
function deepEqualStable(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => k in (b as object) && deepEqualStable((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** 盘上基线:最后一次写盘时本实例真实有过(内存或旧基线)的盘像;null = boot 前
 *  或从未见过盘。他实例新增被吸收落盘但不入基线(见 advanceBaseline)。 */
let diskBaseline: AppSettings | null = null;

/** 基线推进:内存有过的 key 取 payload 值;旧基线有而内存没有的(被他实例改动
 *  后存活下来的)保留旧戳——若随 payload 新值入基线,下一次 persist 会拿它跟盘
 *  上同一新值比出「未改动」误判本地删除(双实例丢更新回归,2026-09-13 review
 *  实证)。他实例新增(两处都没有)不入基线,落盘照旧、下轮继续照收。 */
function advanceBaseline(memory: AppSettings, payload: AppSettings): void {
  const next = { ...payload } as unknown as Record<string, unknown>;
  for (const field of [...Object.keys(MERGE_TS_FIELDS), ...MERGE_PLAIN_FIELDS]) {
    const mem = memory[field as keyof AppSettings] as unknown as RecordLike;
    const old = diskBaseline
      ? (diskBaseline[field as keyof AppSettings] as unknown as RecordLike)
      : null;
    const merged = next[field] as RecordLike;
    const proj: RecordLike = {};
    for (const key of Object.keys(merged)) {
      if (key in mem) proj[key] = merged[key];
      else if (old !== null && key in old) proj[key] = old[key];
    }
    next[field] = proj;
  }
  diskBaseline = next as unknown as AppSettings;
}

/** per-key 合并:盘上条目除「本地已删」外全收,本实例 key 覆盖(带 ts 时较新者胜)。 */
function mergeEntries(
  memory: RecordLike,
  disk: RecordLike,
  tsField: string | null,
  base: RecordLike | null,
): RecordLike {
  const out: RecordLike = { ...disk };
  /* 内存没有而盘上有的 key:基线里已有且自基线后未被外实例改动 → 本地删除,
     删除意图赢(否则取消置顶/归档永不落盘,重启复活);基线里没有 → 外实例
     新增,照收(双实例丢更新防护不变)。 */
  if (base)
    for (const key of Object.keys(out)) {
      if (key in memory) continue;
      const mine = base[key];
      if (mine === undefined) continue;
      const gone =
        tsField === null
          ? deepEqualStable(out[key], mine)
          : (typeof out[key][tsField] === "number" ? (out[key][tsField] as number) : -1) <=
            (typeof mine[tsField] === "number" ? (mine[tsField] as number) : -1);
      if (gone) delete out[key];
    }
  for (const key of Object.keys(memory)) {
    const theirs = out[key];
    if (theirs === undefined || tsField === null) {
      out[key] = memory[key];
      continue;
    }
    const a = typeof memory[key][tsField] === "number" ? (memory[key][tsField] as number) : -1;
    const b = typeof theirs[tsField] === "number" ? (theirs[tsField] as number) : -1;
    if (a >= b) out[key] = memory[key];
  }
  return out;
}

/**
 * 双实例丢更新防护:dev 版与打包版可能并存(2026-09-11 实证),共享
 * settings.json 且写盘是全文件覆盖、后写者赢 —— 陈旧实例一次写盘即抹掉
 * 另一实例刚写的归档/置顶等标记(表现为「归档无效且无提示」)。persist
 * 前拉盘上最新做记录层合并:标记类字段按 key 并集,标量仍以本实例为准。
 * 删除意图靠 diskBaseline 判别:盘上有、内存没有、基线里已有且自基线未被他
 * 实例改动 → 本地删除(否则取消置顶永不落盘,重启复活);基线里没有 → 他
 * 实例新增,照收且不入基线。合并只作用于写盘 payload,不回写内存态 —— 他窗
 * 标记不实时串进本窗,重载生效。
 */
function mergeDiskIntoPayload(memory: AppSettings, raw: unknown): AppSettings {
  const disk = sanitize(raw);
  const base = diskBaseline;
  const out = { ...memory } as unknown as Record<string, unknown>;
  for (const [field, tsField] of Object.entries(MERGE_TS_FIELDS)) {
    out[field] = mergeEntries(
      memory[field as keyof AppSettings] as unknown as RecordLike,
      disk[field as keyof AppSettings] as unknown as RecordLike,
      tsField,
      base ? (base[field as keyof AppSettings] as unknown as RecordLike) : null,
    );
  }
  for (const field of MERGE_PLAIN_FIELDS) {
    out[field] = mergeEntries(
      memory[field] as unknown as RecordLike,
      disk[field] as unknown as RecordLike,
      null,
      base ? (base[field] as unknown as RecordLike) : null,
    );
  }
  return out as unknown as AppSettings;
}

/** persist 串行链:并发交错的读盘→合并→写盘可能乱序落盘(后发先至会用陈旧
 *  盘像复活已删标记),链式排队保证基线推进与写序一致。persistNow 永不 reject。 */
let persistChain: Promise<void> = Promise.resolve();

function persist(): void {
  persistChain = persistChain.then(persistNow);
}

async function persistNow(): Promise<void> {
  const memory = state.settings;
  try {
    let payload = memory;
    try {
      payload = mergeDiskIntoPayload(memory, await ipc.configReadSettings());
    } catch {
      /* 盘不可读(他实例锁文件等):按本实例状态原样写,行为同旧 */
    }
    await ipc.configWriteSettings(payload);
    advanceBaseline(memory, payload);
  } catch (err) {
    // 浏览器 dev:降级 localStorage
    try {
      localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(memory));
      diskBaseline = memory;
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
  diskBaseline = state.settings;
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
