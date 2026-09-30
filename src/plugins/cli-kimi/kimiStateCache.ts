/**
 * kimi state.json 解析缓存 —— 自 kimiSessions 拆出(文件规模铁则的叶子模块;
 * parser 注入,不反向依赖扫描模块)。state 是落盘后基本静态的小 JSON(标题/归档
 * 变更会刷 mtime,缓存自然失效),mtime 未变即复用解析产物,重扫收敛为
 * fs_collect_files + 仅新/变文件读。池按 path 全局共享 —— W 工作区并发扫同一
 * 目录,跨工作区重复读消失。解析失败不缓存(下轮重读);上限防目录无限增长
 * 泄漏(语义同 cli-shared headCache)。
 */

import { ipc } from "@kernel/ipc";

const STATE_CACHE_MAX = 8192;
const stateCache = new Map<string, { mtime: number; state: unknown }>();

/** 读 state.json 并解析,带 mtime 缓存;读失败/坏 JSON = null 且不落缓存。 */
export function readKimiStateCached<T>(
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
        if (stateCache.size >= STATE_CACHE_MAX) {
          const oldest = stateCache.keys().next().value;
          if (oldest !== undefined) stateCache.delete(oldest);
        }
        stateCache.set(path, { mtime, state: parsed });
      } else {
        stateCache.delete(path);
      }
      return parsed;
    },
    () => null,
  );
}

/** 缓存剪除:collect 已消失的 state 条目丢弃。 */
export function pruneKimiStateCache(livePaths: Set<string>): void {
  for (const p of [...stateCache.keys()]) {
    if (!livePaths.has(p)) stateCache.delete(p);
  }
}
