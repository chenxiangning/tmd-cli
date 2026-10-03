/**
 * 侧栏工作区的 worktree 归簇(2026-09-26 方案 A,结构层):
 * 每张卡 root 懒加载 `git worktree list`(主仓恒首条),主仓锚 = entries[0].
 * path(输入前缀已由 Rust 回贴统一);同锚的卡归为一簇 —— 主仓卡在前,
 * worktree 卡平级跟随,整簇由边框归组(2026-09-26 起弃父子缩进)。
 * 模块级缓存(60s TTL;失败负记录 10s):侧栏刷新节律下不重复 git spawn。
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
  /** probe 失败(非 git 目录等):短 TTL 负缓存,防每次 store 事件重 spawn git。 */
  failed?: boolean;
}

const TTL_MS = 60_000;
const FAIL_TTL_MS = 10_000;
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
  if (hit && Date.now() - hit.at < (hit.failed ? FAIL_TTL_MS : TTL_MS)) return hit;
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
    .catch(() => {
      /* 非仓/命令失败也落短 TTL 负记录:否则每次切换/重命名工作区
       * (store emit → roots 新引用 → effect 重跑)都对非仓目录真起 git 进程。 */
      const entry: CacheEntry = { at: Date.now(), members: new Map(), failed: true };
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** 同步读缓存(绝不 spawn git):侧栏挂载即对全部 root 预探,菜单打开时缓存必热。
 *  供 app-shell 的工作区菜单行(底栏显隐多选/切换下拉)借用 worktree 身份选图标
 *  —— 跨层消费声明(app-shell → @plugins/workspace,先例 DesktopApp 的挂点式引用):
 *  簇知识与缓存归本模块,菜单只读不写;未探测过返回 null,调用方回落普通
 *  文件夹图标,不做猜测兜底。
 *  不设 TTL 门(2026-10-04 真窗目检二修):侧栏图标吃 hook 内 React state,
 *  TTL 过期后照常显示 fork;菜单若因缓存过期回落文件夹,同屏两处对不上 ——
 *  故读「最后已知簇身份」,与侧栏显示口径一致,下次探测自然纠正。 */
export function peekWorktreeMeta(root: string): WorktreeClusterMeta | null {
  const key = normalizeRoot(root);
  for (const entry of cache.values()) {
    const m = entry.members.get(key);
    if (m) return m;
  }
  return null;
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

/** 簇分桶:同 mainRoot 归一桶,主仓卡在 main、worktree 卡按原序在 children,
 * 簇间保持原相对序;非仓 / 无簇信息 = 自成孤桶(main 为 null)。
 * 主仓未加入侧栏时桶内只有 children,渲染侧仍整簇套框。 */
export interface WorktreeBucket<T extends { root: string }> {
  main: T | null;
  children: T[];
}

export function clusterBuckets<T extends { root: string }>(
  items: readonly T[],
  meta: Record<string, WorktreeClusterMeta>,
): WorktreeBucket<T>[] {
  const buckets = new Map<string, WorktreeBucket<T>>();
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
    /* main 槽位先到先得:同 root 重复卡(addWorkspace 零判重)落 children,
     * 否则后到者覆盖 main、前者两不沾边被静默丢渲染(2026-09-27 评审 P1)。 */
    if (m?.isMain && !bucket.main) bucket.main = it;
    else bucket.children.push(it);
  }
  return order.map((key) => buckets.get(key)!);
}
