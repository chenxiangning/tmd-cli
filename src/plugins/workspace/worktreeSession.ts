/**
 * 会话 ↔ worktree 关联(批次三):localStorage 映射 + slug/冲突递增纯函数。
 * 工作区右键菜单「在新 worktree 中起会话」创建后记录,徽标双向反查(map 反查,
 * 不新增扫描);磁盘占用走 git_worktree_disk_usage,与本模块无关。
 */

import { host } from "@kernel/host";
import { branchForWorktree } from "@plugins/git/worktree/dirName";
import { normalizeRoot } from "@plugins/git/worktree/worktreeOps";
/* 词典随链路注册(workspace 弹层先于 git 插件加载时保证 en/ja 命中)。 */
import "@plugins/git/worktree/locales";

const STORE_KEY = "tmd.wtSessions.v1";

/** 会话 → worktree 关联记录(sessionId 为 spawn 返回的活会话 id)。 */
export interface WtSessionRef {
  branch: string;
  wtPath: string;
  root: string;
}

/** 版本号作读缓存键:map 每读重建,行区高频渲染经此免重复 parse。 */
let mapMemo: { v: number; map: Record<string, WtSessionRef> } | null = null;

export function loadWtSessions(): Record<string, WtSessionRef> {
  if (mapMemo?.v === version) return mapMemo.map;
  let map: Record<string, WtSessionRef> = {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) map = JSON.parse(raw) as Record<string, WtSessionRef>;
  } catch {
    map = {};
  }
  mapMemo = { v: version, map };
  return map;
}

function saveWtSessions(map: Record<string, WtSessionRef>): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(map));
  version += 1;
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();
let version = 0;

/** 徽标订阅(useSyncExternalStore 用);map 仅本地写,无需跨窗同步。 */
export function subscribeWtSessions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function wtSessionsVersion(): number {
  return version;
}

export function recordWtSession(sessionId: string, ref: WtSessionRef): void {
  saveWtSessions({ ...loadWtSessions(), [sessionId]: ref });
}

/** 会话 id → 关联记录(仅活会话且实跑在该 worktree 才返回:映射随 localStorage
 *  跨运行残留,pty id 会被新运行复用,以活会话 cwd 复核防张冠李戴)。 */
export function wtSessionOf(sessionId: string | undefined): WtSessionRef | undefined {
  if (!sessionId) return undefined;
  const ref = loadWtSessions()[sessionId];
  if (!ref) return undefined;
  const live = host.getSessions().find((s) => s.id === sessionId);
  return live && normalizeRoot(live.cwd) === normalizeRoot(ref.wtPath) ? ref : undefined;
}

/** wtPath → 在此运行的活会话数(移除闸 + 管理弹窗徽标)。以活会话表 cwd 为准
 *  (归一比较):映射是 spawn 时的写入侧账本,拿它计数会把已关会话与上次运行
 *  的残留 id 一并算上(移除闸误拦);cwd 口径还天然覆盖终端/普通 spawn 落在
 *  worktree 的会话,不漏不虚。 */
export function countSessionsForWtPath(wtPath: string): number {
  const target = normalizeRoot(wtPath);
  return host.getSessions().filter((s) => normalizeRoot(s.cwd) === target).length;
}

/**
 * 分支冲突递增:base 已在 taken 集中 → 依次尝试 `${base}-2` `-3` …;
 * base 本身未被占用则原样返回。纯函数(单测覆盖)。
 */
export function bumpBranch(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** 创建时统一入口:裸名加 wt/ 前缀后再做冲突递增。 */
export function finalBranchName(base: string, taken: ReadonlySet<string>): string {
  return bumpBranch(branchForWorktree(base), taken);
}
