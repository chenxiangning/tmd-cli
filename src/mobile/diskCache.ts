/**
 * 手机端 localStorage 磁盘缓存(2026-10-06 外网链路慢优化:列表/详情/时间线
 * 本地缓存 + 增量拉取)—— 版本化信封 {v, host, at, data};host = 桌面稳定身份
 * (transport.serverHostId,多台桌面共用一台手机时防串缓存;未连接/旧桌面 =
 * "unknown" 桶),读时 host 不符 = miss。缓存是纯优化:读写失败一律静默,
 * 主路 RPC 语义不变。
 */
import React from "react";
import { onServerHello, serverHostId } from "@kernel/transport";
import type { TranscriptTurn } from "@kernel/transcript";
import type { HistoryItem } from "./history";

/** 信封版本:结构不兼容变更时 +1(旧值自然 miss)。 */
const V = 1;
/** 本模块全部缓存 key 的统一前缀(配额淘汰的识别域)。 */
const PREFIX = "tmd.m.";

interface Envelope<T> {
  v: number;
  host: string;
  at: number;
  data: T;
}

/** 桥身份兜底:未连接/旧桌面/桩环境缺导出 = "unknown" 桶(缓存是优化,不碍主路)。 */
const hostId = (): string => {
  try {
    return serverHostId() ?? "unknown";
  } catch {
    return "unknown";
  }
};

/** 读缓存:缺值/坏 JSON/版本或 host 不符 = null。 */
export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== V || env.host !== hostId()) return null;
    return env.data;
  } catch {
    return null;
  }
}

/** 写缓存(内部打 host/at):配额满先逐最旧一条本前缀缓存再重试一次,仍败放弃。
 *  超大 blob(≥ BLOB_GIVEUP)直接放弃不逐兄弟键 —— 单条自身放不进配额时,
 *  逐空全部兄弟缓存也救不回,徒劳驱逐只会连带杀死 home/transcript 缓存
 *  (2026-10-06 评审 P1:时间线大 blob 曾逐条吃光兄弟键)。 */
const BLOB_GIVEUP = 2 * 1024 * 1024;

export function writeCache(key: string, data: unknown): void {
  const raw = JSON.stringify({ v: V, host: hostId(), at: Date.now(), data });
  if (raw.length >= BLOB_GIVEUP) return;
  try {
    localStorage.setItem(key, raw);
    return;
  } catch {
    /* 配额满:进淘汰重试 */
  }
  try {
    dropOldest(key);
    localStorage.setItem(key, raw);
  } catch {
    /* 放弃:缓存是优化,不碍主路 */
  }
}

/** 逐最旧一条本前缀缓存(坏条目优先;keepKey 自身不逐——刚写失败的条目龄最新)。 */
function dropOldest(keepKey: string): void {
  let oldest: string | null = null;
  let oldestAt = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k === keepKey || !k.startsWith(PREFIX)) continue;
    let at = -1; /* 坏/异型条目龄 = -1,优先逐 */
    try {
      at = (JSON.parse(localStorage.getItem(k) ?? "") as Envelope<unknown>).at ?? -1;
    } catch {
      /* 保持 -1 */
    }
    if (at < oldestAt) {
      oldestAt = at;
      oldest = k;
    }
  }
  if (oldest) localStorage.removeItem(oldest);
}

/** LRU 裁剪(纯函数,各特性裁剪条目数用):条目带 at 写时龄,超 max 逐最旧。 */
export function pruneLru<T extends { at: number }>(
  entries: Record<string, T>,
  max: number,
): Record<string, T> {
  const keys = Object.keys(entries);
  if (keys.length <= max) return entries;
  const keep = new Set(keys.sort((a, b) => entries[b].at - entries[a].at).slice(0, max));
  return Object.fromEntries(keys.filter((k) => keep.has(k)).map((k) => [k, entries[k]]));
}

/* ── home 历史列表缓存(Record<root, HistoryItem[]>;每 root 截最新 60 条,root 数不设限) ── */
const HIST_KEY = "tmd.m.hist.v1";
const HIST_PER_ROOT = 60;

/** 挂载 hydrate:缓存在场的 root 首屏即显。 */
export function readHomeHistory(): Map<string, HistoryItem[]> {
  const c = readCache<Record<string, HistoryItem[]>>(HIST_KEY);
  return new Map(c ? Object.entries(c) : []);
}

/** 单 root 扫描成功回写(扫描失败的 root 不调 = 缓存不动);按 modifiedAt 倒序截 60。 */
export function writeHomeHistoryRoot(root: string, items: HistoryItem[]): void {
  const all = readCache<Record<string, HistoryItem[]>>(HIST_KEY) ?? {};
  all[root] = [...items]
    .sort((a, b) => b.session.modifiedAt - a.session.modifiedAt)
    .slice(0, HIST_PER_ROOT);
  writeCache(HIST_KEY, all);
}

/** home 历史 state Hook:lazy 初始化即 hydrate;冷启动挂载先于 hello(此时 host 落
 *  "unknown" 桶必然 miss)→ hello 到达补一次 hydrate(仅当仍空,不盖更鲜扫描)。 */
export function useHomeHistory(): [
  Map<string, HistoryItem[]>,
  React.Dispatch<React.SetStateAction<Map<string, HistoryItem[]>>>,
] {
  const [m, setM] = React.useState(() => readHomeHistory());
  React.useEffect(
    () => onServerHello(() => setM((cur) => (cur.size ? cur : readHomeHistory()))),
    [],
  );
  return [m, setM];
}

/* ── transcript 详情缓存(Record<path, {size, turns, at}>;LRU 20 条) ── */
const TR_KEY = "tmd.m.tr.v1";
const TR_LRU = 20;

export interface TranscriptCacheEntry {
  size: number;
  turns: TranscriptTurn[];
  at: number;
}

export function readTranscriptCache(path: string): TranscriptCacheEntry | null {
  return readCache<Record<string, TranscriptCacheEntry>>(TR_KEY)?.[path] ?? null;
}

/** 只有非 null 结果入缓存(错误态/空态不入)。 */
export function writeTranscriptCache(path: string, size: number, turns: TranscriptTurn[]): void {
  const all = readCache<Record<string, TranscriptCacheEntry>>(TR_KEY) ?? {};
  all[path] = { size, turns, at: Date.now() };
  writeCache(TR_KEY, pruneLru(all, TR_LRU));
}
