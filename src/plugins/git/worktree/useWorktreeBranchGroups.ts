/**
 * BranchView 的 worktree 归组数据面(自 BranchView 拆出:文件规模铁则)。
 * 拉取当前仓 worktree 列表,产出本地分支的三分区与「是否分区渲染」开关;
 * 非仓 / 命令失败回退平铺(zoned = false),零打扰。
 */

import { useEffect, useMemo, useState } from "react";
import { type GitBranchInfo, type WorktreeEntry } from "@kernel/ipc";
import { groupBranchesByWorktree } from "./worktreeBranchGroups";
import { listWorktrees } from "./worktreeOps";
import { useGitPanelState } from "../panelStore";

export function useWorktreeBranchGroups(cwd: string, locals: readonly GitBranchInfo[]) {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[] | null>(null);
  /* 随全局刷新 nonce 重拉:worktree 增删后不重拉会残留已删树的空组头
   * (弹窗/常驻区移除路径全走 bumpGitRefresh)。 */
  const { refreshNonce } = useGitPanelState();
  useEffect(() => {
    let alive = true;
    listWorktrees(cwd)
      .then((list) => alive && setWorktrees(list))
      .catch(() => alive && setWorktrees([]));
    return () => {
      alive = false;
    };
  }, [cwd, refreshNonce]);
  const groups = useMemo(
    () => groupBranchesByWorktree(locals, worktrees ?? [], cwd),
    [locals, worktrees, cwd],
  );
  /* 树数据缺失(非仓/命令失败)或单树仓回退平铺。 */
  const zoned = (worktrees?.length ?? 0) > 1;
  return { groups, zoned };
}
