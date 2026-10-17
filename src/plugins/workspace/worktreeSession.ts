/**
 * 会话 ↔ worktree 关联(批次三):localStorage 映射 + slug/冲突递增纯函数。
 * 会话卡右键「在新 worktree 中起会话」创建后记录,徽标双向反查(map 反查,
 * 不新增扫描);磁盘占用走 git_worktree_disk_usage,与本模块无关。
 */

import { branchForWorktree } from "@plugins/git/worktree/dirName";
/* 词典随链路注册(workspace 弹层先于 git 插件加载时保证 en/ja 命中)。 */
import "@plugins/git/worktree/locales";

const STORE_KEY = "tmd.wtSessions.v1";

/** 会话 → worktree 关联记录(sessionId 为 spawn 返回的活会话 id)。 */
export interface WtSessionRef {
  branch: string;
  wtPath: string;
  root: string;
}

export function loadWtSessions(): Record<string, WtSessionRef> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WtSessionRef>) : {};
  } catch {
    return {};
  }
}

/** 幽灵清理:按存活 tmd 会话 id 集剪除映射(会话关闭无删除点,管理弹窗
 * 打开时收口一次,防会话数徽标对死会话永久虚高)。 */
export function pruneWtSessions(liveIds: ReadonlySet<string>): void {
  const map = loadWtSessions();
  const kept = Object.keys(map).filter((id) => liveIds.has(id));
  if (kept.length === Object.keys(map).length) return;
  const next: Record<string, WtSessionRef> = {};
  for (const id of kept) next[id] = map[id];
  saveWtSessions(next);
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

/** 会话 id → 关联记录;无记录 = undefined。 */
export function wtSessionOf(sessionId: string | undefined): WtSessionRef | undefined {
  if (!sessionId) return undefined;
  return loadWtSessions()[sessionId];
}

/** wtPath → 关联会话数(管理弹窗列表行徽标;map 反查)。 */
export function countSessionsForWtPath(wtPath: string): number {
  const target = wtPath.replace(/[\\/]+$/, "");
  return Object.values(loadWtSessions()).filter(
    (r) => r.wtPath.replace(/[\\/]+$/, "") === target,
  ).length;
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

/** 右键菜单 worktree 目标构造:活会话 cwd 优先,否则回工作区根;其余透传。 */
export function spawnWorktreeFor(
  row: { workspace: { id: string; root: string }; profile: { id: string } },
  liveCwd: string | null,
  title: string,
): { repoCwd: string; workspaceId: string; profileId: string; title: string } {
  return {
    repoCwd: liveCwd ?? row.workspace.root,
    workspaceId: row.workspace.id,
    profileId: row.profile.id,
    title,
  };
}
