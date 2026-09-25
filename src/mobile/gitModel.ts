/**
 * gitModel —— Git 面板的数据加载与文案(纯逻辑,UI 在 GitScreen.tsx)。
 * 契约类型来自 @kernel/gitContract(serde camelCase 对齐 Rust);加载失败
 * 的命令回落 null(面板按「不可用」渲染,不阻塞其余视图)。
 */
import { invoke } from "@kernel/transport";
import type {
  GitAheadBehind,
  GitBranchList,
  GitDiffStatus,
  GitLogEntry,
  GitRemoteOpReport,
  GitTotals,
} from "@kernel/gitContract";

export type RemoteOp = "fetch" | "pull" | "push";

export interface GitSnapshot {
  status: GitDiffStatus | null;
  totals: GitTotals | null;
  ab: GitAheadBehind | null;
  branches: GitBranchList | null;
  log: GitLogEntry[] | null;
}

/** 五命令并行拉一版快照;任一失败 = 该项 null(E_* 错误语义见 gitContract)。 */
export async function loadGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const [status, totals, ab, branches, log] = await Promise.all([
    invoke<GitDiffStatus>("git_status", { cwd }).catch(() => null),
    invoke<GitTotals>("git_totals", { cwd }).catch(() => null),
    invoke<GitAheadBehind>("git_ahead_behind", { cwd }).catch(() => null),
    invoke<GitBranchList>("git_branches", { cwd }).catch(() => null),
    invoke<GitLogEntry[]>("git_log", { cwd, limit: 50, offset: 0 }).catch(() => null),
  ]);
  return { status, totals, ab, branches, log };
}

/** 文件差异 patch(加载失败 = null);untracked 走 full。 */
export async function fetchFilePatch(cwd: string, path: string, staged: boolean, untracked: boolean) {
  return invoke<{ patch: string; binary: boolean }>("git_diff_file_patch", {
    cwd,
    path,
    staged: untracked ? false : staged,
    full: untracked,
  }).catch(() => null);
}

/** 提交改动清单(失败 = 空表)。 */
export async function fetchCommitFiles(cwd: string, sha: string) {
  return invoke<{ path: string; additions: number; deletions: number }[]>("git_commit_files", { cwd, sha }).catch(() => []);
}

/** 远端操作结果 → 人话一行(纯函数,测试锚定;字段语义见 gitContract)。 */
export function opReportText(op: RemoteOp, r: GitRemoteOpReport): string {
  if (r.upToDate) return "已是最新";
  if (op === "fetch") return `获取完成,更新 ${r.refs} 个远端引用`;
  if (op === "push") return `已推送 ${r.commits} 个提交`;
  return `已拉取 ${r.commits} 个提交,变更 ${r.files} 个文件(+${r.insertions}/-${r.deletions})`;
}
