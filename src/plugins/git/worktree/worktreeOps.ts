/**
 * worktree 共享操作层 —— WorktreeManageDialog(弹窗)与 WorktreeZone(Git 面板
 * 常驻区)共用的移除清理流与打开/终端入口;两处 UI 不重复编排。
 */

import { ipc, type WorktreeEntry } from "@kernel/ipc";
import { addWorkspace, getWorkspaces, removeWorkspace, setActiveWorkspace } from "@kernel/workspace";
import { host } from "@kernel/host";

/** 路径归一(比较口径):`\`→`/`、去尾分隔符。worktree list 与 repos_scan
 *  的前缀口径已由 Rust 侧回贴统一,这里只兜格式差。 */
export function normalizeRoot(p: string): string {
  const u = p.replace(/\\/g, "/");
  return u.length > 1 ? u.replace(/\/+$/, "") : u;
}

/** 移除 worktree 并做对称清理:同 root 的工作区一并摘除;分支尾巴安全删
 *  (-d 语义,未合并被拒则保留)。返回分支尾注(调用方拼进 notice)。
 *  siblings = 同仓 worktree 全列表(判定分支是否被其他树检出)。 */
export async function removeWorktreeWithCleanup(
  cwd: string,
  entry: WorktreeEntry,
  siblings: readonly WorktreeEntry[],
): Promise<{ branchDeleted: boolean; branchKept: boolean }> {
  await ipc.gitWorktreeRemove(cwd, entry.path, false);
  const ws = getWorkspaces().find((w) => normalizeRoot(w.root) === normalizeRoot(entry.path));
  if (ws) removeWorkspace(ws.id);
  /* 分支被其他 worktree 检出时跳过:动它会弄残那棵树。 */
  const shared = siblings.some(
    (e) => e !== entry && !e.bare && e.branch !== "" && e.branch === entry.branch,
  );
  if (!entry.branch || shared) return { branchDeleted: false, branchKept: false };
  try {
    await ipc.gitDeleteBranch(cwd, entry.branch, false);
    return { branchDeleted: true, branchKept: false };
  } catch {
    return { branchDeleted: false, branchKept: true };
  }
}

/** 打开该 worktree 为工作区:已在侧栏则激活,不在则落库后激活。返回工作区 id。 */
export function openWorktreeWorkspace(path: string): string {
  const existing = getWorkspaces().find((w) => normalizeRoot(w.root) === normalizeRoot(path));
  const ws = existing ?? addWorkspace(path);
  setActiveWorkspace(ws.id);
  return ws.id;
}

/** 在该 worktree 开内置终端:复用「打开为工作区」后走 kernel shell 会话装配。 */
export async function spawnTerminalAt(path: string): Promise<void> {
  const wsId = openWorktreeWorkspace(path);
  await host.createShellSession(wsId);
}
