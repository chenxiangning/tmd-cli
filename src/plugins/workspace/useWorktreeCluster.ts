/**
 * 侧栏工作区的 worktree 归簇(2026-09-26 方案 A,结构层):
 * 每张卡 root 懒加载 `git worktree list`(主仓恒首条),主仓锚 = entries[0].
 * path(输入前缀已由 Rust 回贴统一);同锚的卡归为一簇 —— 主仓卡在前,
 * worktree 卡缩进跟随。模块级缓存(60s TTL):侧栏刷新节律下不重复 git spawn。
 * 非 git 目录 / 命令失败 = 无簇信息,卡片原样平铺,零打扰。
 *
 * P0 纪律(2026-09-26 卡死事故):roots 引用必须由调用方 useMemo 钉住,
 * 本 hook 的 setState 一律先等值兜底(同引用返回 prev),杜绝渲染循环。
 */

import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";

export interface WorktreeClusterMeta {
  /** 所在仓的主仓根(= 簇键);root 自身是主仓时等于 root。 */
  mainRoot: string;
  /** 卡 root 是主仓本体(非 worktree 子卡)。 */
  isMain: boolean;
}

interface CacheEntry {
  at: number;
  /** root → 该卡归属;未命中 = 非本仓的目录。 */
  members: Map<string, WorktreeClusterMeta>;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function normalizeRoot(p: string): string {
  const u = p.replace(/\\/g, "/");
  return u.length > 1 ? u.replace(/\/+$/, "") : u;
}

/** 对 root 跑 worktree list 并建簇(带 TTL 缓存与在途合并)。 */
async function probe(root: string): Promise<CacheEntry> {
  const key = normalizeRoot(root);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const job = ipc
    .gitWorktreeList(root)
    .then((entries) => {
      const entry: CacheEntry = { at: Date.now(), members: new Map() };
      if (entries.length > 0) {
        const mainRoot = normalizeRoot(entries[0].path);
        for (const e of entries) {
          entry.members.set(normalizeRoot(e.path), {
            mainRoot,
            isMain: normalizeRoot(e.path) === mainRoot,
          });
        }
      } else {
        /* 空列表(异常):root 自成孤簇,不当 worktree 处理。 */
        entry.members.set(key, { mainRoot: key, isMain: true });
      }
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** 侧栏传入的全部 root → 每卡的簇元数据(未加载完成前缺失键)。 */
export function useWorktreeCluster(roots: readonly string[]): Record<string, WorktreeClusterMeta> {
  const [meta, setMeta] = useState<Record<string, WorktreeClusterMeta>>({});
  useEffect(() => {
    let alive = true;
    void Promise.all(
      roots.map(async (root) => {
        try {
          const entry = await probe(root);
          const mine = entry.members.get(normalizeRoot(root));
          if (!alive || !mine) return;
          /* 等值兜底:同引用不触发重渲染(渲染循环防线,见文件头 P0 纪律)。 */
          setMeta((prev) => (prev[root] === mine ? prev : { ...prev, [root]: mine }));
        } catch {
          /* 非仓目录:无簇信息,卡片原样。 */
        }
      }),
    );
    return () => {
      alive = false;
    };
  }, [roots]);
  return meta;
}

/** 簇渲染序:同簇相邻(主仓卡在前,worktree 按原序跟随),簇间保持原相对序。 */
export function clusterOrder<T extends { root: string }>(
  items: readonly T[],
  meta: Record<string, WorktreeClusterMeta>,
): T[] {
  const buckets = new Map<string, { main: T | null; children: T[] }>();
  const order: string[] = [];
  for (const it of items) {
    const m = meta[it.root];
    const key = m ? m.mainRoot : `\0solo:${it.root}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { main: null, children: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    if (m?.isMain) bucket.main = it;
    else bucket.children.push(it);
  }
  const out: T[] = [];
  for (const key of order) {
    const b = buckets.get(key)!;
    if (b.main) out.push(b.main);
    out.push(...b.children);
  }
  return out;
}
