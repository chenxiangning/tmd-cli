/**
 * BranchView 的 worktree 归组数据面(自 BranchView 拆出:文件规模铁则)。
 * 拉取当前仓 worktree 列表,产出本地分支的三分区与「是否分区渲染」开关;
 * 非仓 / 命令失败回退平铺(zoned = false),零打扰。
 */

import { useEffect, useMemo, useState } from "react";
import { ipc, type GitBranchInfo, type WorktreeEntry } from "@kernel/ipc";
import { groupBranchesByWorktree } from "./worktreeBranchGroups";

export function useWorktreeBranchGroups(cwd: string, locals: readonly GitBranchInfo[]) {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    ipc
      .gitWorktreeList(cwd)
      .then((list) => alive && setWorktrees(list))
      .catch(() => alive && setWorktrees([]));
    return () => {
      alive = false;
    };
  }, [cwd]);
  const groups = useMemo(
    () => groupBranchesByWorktree(locals, worktrees ?? [], cwd),
    [locals, worktrees, cwd],
  );
  /* 树数据缺失(非仓/命令失败)或单树仓回退平铺。 */
  const zoned = (worktrees?.length ?? 0) > 1;
  return { groups, zoned };
}
