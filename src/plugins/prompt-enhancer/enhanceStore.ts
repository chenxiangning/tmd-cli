/**
 * 增强提示词持久化层 —— 插件私有 JSON(configDir()/prompt-enhancer.json,
 * wallpaper/store.ts 同款先例:配置目录布局 owner 是 Rust session.rs,插件不自拼)。
 *
 * 三块状态:① lastUsed 上次选择(引擎/档位/模型/超时,下次打开直接恢复);
 * ② cache 结果缓存(同 草稿+引擎+档位+模型 命中秒回零额度,LRU 20,mossx 思路落盘);
 * ③ history 最近 20 条(原文/终稿/引擎/档位/模型/时间,可回填可重跑)。
 * 读写全走 fsReadFile/fsWriteFile 通用原语,损坏文件静默重置(内容非关键数据)。
 */

import { ipc } from "@kernel/ipc";
import type { EnhancePreset } from "./enhanceEngines";

export interface EnhanceLastUsed {
  engineId: string;
  preset: EnhancePreset;
  model: string;
  timeoutSeconds: number;
}

export interface EnhanceHistoryEntry {
  original: string;
  enhanced: string;
  engineId: string;
  preset: EnhancePreset;
  model: string;
  at: number;
}

interface StoreShape {
  lastUsed?: EnhanceLastUsed;
  cache: Record<string, { text: string; at: number }>;
  history: EnhanceHistoryEntry[];
}

const FILE = "prompt-enhancer.json";
export const CACHE_MAX = 20;
export const HISTORY_MAX = 20;

let state: StoreShape = { cache: {}, history: [] };
let loaded = false;

/** 测试注入:持久化目标(默认 fs 真盘)。 */
let persist = {
  read: (): Promise<string | null> => _read(),
  write: (text: string): Promise<void> => _write(text),
};

async function _read(): Promise<string | null> {
  try {
    const dir = await ipc.configDir();
    if (!dir) return null;
    return await ipc.fsReadFile(`${dir}/${FILE}`);
  } catch {
    return null; /* 无文件/读失败 = 首次/损坏,重置 */
  }
}

async function _write(text: string): Promise<void> {
  try {
    const dir = await ipc.configDir();
    if (!dir) return;
    await ipc.fsWriteFile(`${dir}/${FILE}`, text);
  } catch {
    /* 写失败静默:缓存/历史非关键数据 */
  }
}

/** 测试注桩:替换持久化目标(空 = 还原真盘)。 */
export function __usePersist(target?: { read(): Promise<string | null>; write(t: string): Promise<void> }): void {
  persist = target ?? { read: _read, write: _write };
}

export async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const raw = await persist.read();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    state = {
      lastUsed: parsed.lastUsed,
      cache: parsed.cache && typeof parsed.cache === "object" ? parsed.cache : {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_MAX) : [],
    };
  } catch {
    state = { cache: {}, history: [] };
  }
}

let saving: Promise<void> = Promise.resolve();
function save(): void {
  /* 串行写盘:乱序并发会让旧态覆盖新态(自增计数器同款纪律) */
  saving = saving.then(() => persist.write(JSON.stringify(state))).catch(() => {});
}

/* ── lastUsed ── */

export function getLastUsed(): EnhanceLastUsed | undefined {
  return state.lastUsed;
}

export function setLastUsed(v: EnhanceLastUsed): void {
  state.lastUsed = v;
  save();
}

/* ── 结果缓存(键 = 引擎|档位|模型|草稿;LRU 20)── */

function cacheKey(engineId: string, preset: EnhancePreset, model: string, draft: string): string {
  return [engineId, preset, model, draft].join("\u0001");
}

export function readCache(engineId: string, preset: EnhancePreset, model: string, draft: string): string | null {
  const key = cacheKey(engineId, preset, model, draft);
  const hit = state.cache[key];
  if (!hit) return null;
  /* LRU touch:命中挪尾 */
  delete state.cache[key];
  state.cache[key] = hit;
  return hit.text;
}

export function writeCache(engineId: string, preset: EnhancePreset, model: string, draft: string, text: string): void {
  const key = cacheKey(engineId, preset, model, draft);
  delete state.cache[key];
  state.cache[key] = { text, at: Date.now() };
  const keys = Object.keys(state.cache);
  while (keys.length > CACHE_MAX) {
    /* 最旧 = 首键(插入序;touch 只挪尾,首键必为最久未用) */
    delete state.cache[keys.shift()!];
  }
  save();
}

/* ── 历史(新→旧,20 条;同 原文+终稿+引擎+档位 刷新置顶)── */

export function getHistory(): readonly EnhanceHistoryEntry[] {
  return state.history;
}

export function pushHistory(entry: EnhanceHistoryEntry): void {
  state.history = state.history.filter(
    (h) => !(h.original === entry.original && h.enhanced === entry.enhanced && h.engineId === entry.engineId && h.preset === entry.preset),
  );
  state.history.unshift(entry);
  if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
  save();
}

/** 测试用:重置内存态与已加载标。 */
export function __reset(): void {
  state = { cache: {}, history: [] };
  loaded = false;
}
