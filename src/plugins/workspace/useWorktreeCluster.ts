/**
 * 侧栏工作区的 worktree 归簇(2026-09-26 方案 A):
 * 每张卡 root 懒加载 `git worktree list`(主仓恒首条),主仓锚 = entries[0].
 * path(输入前缀已由 Rust 回贴统一);同锚的卡归为一簇 —— 主仓卡在前,
 * worktree 卡缩进跟随。模块级缓存(60s TTL):侧栏刷新节律下不重复 git spawn。
 * 非 git 目录 / 命令失败 = 无簇信息,卡片原样平铺,零打扰。
 */

import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";

export interface WorktreeClusterMeta {
  /** 所在仓的主仓根(= 簇键);root 自身是主仓时等于 root。 */
  mainRoot: string;
  /** 该卡检出分支(worktree list 口径);主仓卡也有。 */
  branch: string;
  /** 卡 root 是主仓本体(非 worktree 子卡)。 */
  isMain: boolean;
  /** worktree list 标记 prunable(目录被外部删),卡降灰。 */
  dangling: boolean;
  /** 脏净(未提交文件 > 0);null = 未知(status 失败)。 */
  dirty: boolean | null;
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
          const p = normalizeRoot(e.path);
          entry.members.set(p, {
            mainRoot,
            branch: e.branch,
            isMain: p === mainRoot,
            dangling: e.prunable,
            dirty: null,
          });
        }
        /* 脏净探针逐树补齐(status 失败 = null,点不渲染):先落缓存再异步填,
         * 卡片不因 status 慢而延迟出现。 */
        for (const e of entries) {
          const p = normalizeRoot(e.path);
          void ipc
            .gitStatus(e.path)
            .then((st) => {
              const m = entry.members.get(p);
              if (m) m.dirty = st.files.length > 0;
            })
            .catch(() => undefined);
        }
      } else {
        /* 空列表(异常):root 自成孤簇,不当 worktree 处理。 */
        entry.members.set(key, {
          mainRoot: key,
          branch: "",
          isMain: true,
          dangling: false,
          dirty: null,
        });
      }
      cache.set(key, entry);
      /* status 异步填后让订阅方重读一次(浅比较即可感知)。 */
      setTimeout(() => {
        cache.set(key, { ...entry, at: Date.now() });
      }, 800);
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
    const timers = new Set<number>();
    const apply = (root: string, mine: WorktreeClusterMeta) => {
      if (alive) setMeta((prev) => ({ ...prev, [root]: mine }));
    };
    void Promise.all(
      roots.map(async (root) => {
        try {
          const entry = await probe(root);
          const mine = entry.members.get(normalizeRoot(root));
          if (!alive || !mine) return;
          apply(root, mine);
          /* 脏净探针异步填(~800ms 后):同引用读到补齐值再刷一次。 */
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            if (alive && mine.dirty !== null) apply(root, { ...mine });
          }, 1000);
          timers.add(timer);
        } catch {
          /* 非仓目录:无簇信息,卡片原样。 */
        }
      }),
    );
    return () => {
      alive = false;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [roots]);
  return meta;
}

/** 簇渲染序:同簇相邻(主仓卡在前,worktree 按分支名跟随),簇间保持原相对序。 */
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
