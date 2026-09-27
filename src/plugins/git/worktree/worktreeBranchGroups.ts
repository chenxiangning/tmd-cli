/**
 * 分支按 worktree 检出归属三分区(纯函数,单测覆盖)。
 * 数据源:本地分支列表 + `git worktree list`(主仓恒首条,git 契约)。
 * detached 树(branch="")与 bare 不构成归属组。
 */

import type { GitBranchInfo } from "@kernel/ipc";
import type { WorktreeEntry } from "@kernel/ipc";

export interface WorktreeBranchGroups {
  /** 主仓检出的分支(通常 0/1 条)。 */
  main: GitBranchInfo[];
  /** 非主仓 worktree 检出的分支,按树分组(树序 = worktree list 序,跳过主仓)。 */
  byTree: Array<{ path: string; branch: string; current: boolean; branches: GitBranchInfo[] }>;
  /** 未检出(可用「建树」直接检出)。 */
  free: GitBranchInfo[];
}

/** cwd 归一口径与 worktreeOps.normalizeRoot 一致(纯函数层不 import 组件域)。 */
function norm(p: string): string {
  const u = p.replace(/\\/g, "/");
  return u.length > 1 ? u.replace(/\/+$/, "") : u;
}

export function groupBranchesByWorktree(
  locals: readonly GitBranchInfo[],
  worktrees: readonly WorktreeEntry[],
  cwd: string,
): WorktreeBranchGroups {
  const main = worktrees[0];
  const out: WorktreeBranchGroups = { main: [], byTree: [], free: [] };
  if (!main) return { main: [...locals], byTree: [], free: [] };
  /* 树索引:branch → 组(main 用 null 键)。 */
  const treeGroups = new Map<string, WorktreeBranchGroups["byTree"][number]>();
  for (const wt of worktrees) {
    if (wt.bare || !wt.branch) continue;
    if (wt === main || norm(wt.path) === norm(main.path)) {
      continue;
    }
    treeGroups.set(wt.branch, {
      path: wt.path,
      branch: wt.branch,
      current: norm(wt.path) === norm(cwd),
      branches: [],
    });
  }
  for (const b of locals) {
    if (main.branch && b.name === main.branch) {
      out.main.push(b);
      continue;
    }
    const g = treeGroups.get(b.name);
    if (g) g.branches.push(b);
    else out.free.push(b);
  }
  out.byTree = [...treeGroups.values()];
  return out;
}
