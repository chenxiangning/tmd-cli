/**
 * 状态小文件解析缓存(mtime 闸)—— 自 kimi 私有模块泛化进 cli-shared
 * (2026-10-06:grok summary.json 同款消费,准入 = ≥2 cli-* 消费同一磁盘
 * 读模式;kimi state.json / grok summary.json 先例)。
 *
 * 落盘后基本静态的小 JSON(标题/归档变更会刷 mtime,缓存自然失效),
 * mtime 未变即复用解析产物,重扫收敛为 collect + 仅新/变文件读。池按
 * path 全局共享 —— 跨工作区重复读消失。解析失败不缓存(下轮重读);
 * 上限防目录无限增长泄漏(语义同 headCache)。
 */

import { ipc } from "@kernel/ipc";
import { readHeadsBatched } from "./sessionHead";

const STATE_CACHE_MAX = 8192;
const stateCache = new Map<string, { mtime: number; state: unknown }>();

function evictIfFull(): void {
  if (stateCache.size >= STATE_CACHE_MAX) {
    const oldest = stateCache.keys().next().value;
    if (oldest !== undefined) stateCache.delete(oldest);
  }
}

/** 读状态文件并解析,带 mtime 缓存;读失败/解析 null = null 且不落缓存。 */
export function readStateCached<T>(
  path: string,
  mtime: number,
  parse: (text: string) => T | null,
): Promise<T | null> {
  const cached = stateCache.get(path);
  if (cached && cached.mtime === mtime) return Promise.resolve(cached.state as T);
  return ipc.fsReadFile(path).then(
    (text) => {
      const parsed = text ? parse(text) : null;
      if (parsed) {
        evictIfFull();
        stateCache.set(path, { mtime, state: parsed });
      } else {
        stateCache.delete(path);
      }
      return parsed;
    },
    () => null,
  );
}

/** 批量读状态(列表扫描消费):mtime 命中走缓存,misses 一次批量读头
 *  (外网中继 N+1 削峰;读失败/坏 JSON = null 不落缓存,语义同逐文件版)。
 *  返回与 entries 下标对齐。 */
export async function readStatesBatched<T>(
  entries: { path: string; modifiedAt: number }[],
  parse: (text: string) => T | null,
): Promise<(T | null)[]> {
  const misses = entries.filter((e) => stateCache.get(e.path)?.mtime !== e.modifiedAt);
  const heads = misses.length
    ? await readHeadsBatched(misses.map((m) => m.path), 64 * 1024)
    : [];
  const parsed = new Map<string, T | null>();
  misses.forEach((m, i) => {
    const value = heads[i] ? parse(heads[i]) : null;
    if (value) {
      evictIfFull();
      stateCache.set(m.path, { mtime: m.modifiedAt, state: value });
    } else {
      stateCache.delete(m.path);
    }
    parsed.set(m.path, value);
  });
  return entries.map((e) => {
    if (parsed.has(e.path)) return parsed.get(e.path) ?? null;
    return (stateCache.get(e.path)?.state as T) ?? null;
  });
}

/** 缓存剪枝:目录内已消失文件条目(扫描波收尾调用,防滞留)。 */
export function pruneStateCache(livePaths: Set<string>): void {
  for (const k of stateCache.keys()) {
    if (!livePaths.has(k)) stateCache.delete(k);
  }
}
