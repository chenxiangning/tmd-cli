/**
 * gitModel —— Git 面板的数据加载与文案(纯逻辑,UI 在 GitScreen.tsx)。
 * 契约类型来自 @kernel/gitContract(serde camelCase 对齐 Rust);快照加载失败
 * 的命令回落 null(面板按「不可用」渲染,不阻塞其余视图);点开态(提交文件/
 * 日志翻页)失败上抛,由调用方落错误态 + 重试,不伪装成空/加载中。
 */
import { invoke } from "@kernel/transport";
import { t } from "@kernel/i18n";
import type {
  GitAheadBehind,
  GitBranchList,
  GitDiffStatus,
  GitLogEntry,
  GitRemoteOpReport,
  GitTotals,
} from "@kernel/gitContract";

export type RemoteOp = "fetch" | "pull" | "push";

/** 视图枚举(英文内部值;渲染标签走 t())。 */
export type GitView = "diff" | "branches" | "history";
export const GIT_VIEWS: GitView[] = ["diff", "branches", "history"];
export const GIT_VIEW_LABEL: Record<GitView, string> = {
  diff: "差异",
  branches: "分支",
  history: "历史",
};

/** 日志页大小(git_log limit;offset 翻页,见 fetchGitLogPage)。 */
export const LOG_LIMIT = 50;

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
    invoke<GitLogEntry[]>("git_log", { cwd, limit: LOG_LIMIT, offset: 0 }).catch(() => null),
  ]);
  return { status, totals, ab, branches, log };
}

/** 日志翻页(revwalk offset;失败上抛,调用方 toast)。 */
export function fetchGitLogPage(cwd: string, offset: number): Promise<GitLogEntry[]> {
  return invoke<GitLogEntry[]>("git_log", { cwd, limit: LOG_LIMIT, offset });
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

/** 提交改动清单(失败上抛:调用方落错误态可重试,不再吞成空表伪装空态)。 */
export interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

export function fetchCommitFiles(cwd: string, sha: string): Promise<CommitFile[]> {
  return invoke<CommitFile[]>("git_commit_files", { cwd, sha });
}

/** 提交文件三态(loading/data/error 分离,恒显「加载中…」的回归不再)。 */
export type CommitFilesState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; files: CommitFile[] };

/** 三态 → 渲染种类(纯函数,测试锚定):done 且空表 = 空态,不再冒充加载中。 */
export function commitFilesView(s: CommitFilesState): "loading" | "error" | "empty" | "list" {
  if (s.kind === "loading") return "loading";
  if (s.kind === "error") return "error";
  return s.files.length ? "list" : "empty";
}

/** 翻页并页(纯函数,测试锚定):按 longSha 去重 —— 翻页间隙新提交会平移
 *  revwalk 游标,offset 口径可能重复/跳号,内容寻址兜底。 */
export function mergeLogPage(prev: GitLogEntry[], page: GitLogEntry[]): GitLogEntry[] {
  const seen = new Set(prev.map((c) => c.longSha));
  return [...prev, ...page.filter((c) => !seen.has(c.longSha))];
}

/** 远端操作结果 → 人话一行(纯函数,测试锚定;字段语义见 gitContract)。 */
export function opReportText(op: RemoteOp, r: GitRemoteOpReport): string {
  if (r.upToDate) return t("已是最新");
  if (op === "fetch") return t("获取完成,更新 {n} 个远端引用", { n: r.refs });
  if (op === "push") return t("已推送 {n} 个提交", { n: r.commits });
  return t("已拉取 {c} 个提交,变更 {f} 个文件(+{i}/-{d})", {
    c: r.commits,
    f: r.files,
    i: r.insertions,
    d: r.deletions,
  });
}
