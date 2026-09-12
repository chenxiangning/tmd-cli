/**
 * Git IPC 契约类型 —— 对齐 src-tauri/src/git/*(serde camelCase)。
 * 从 ipc.ts 拆出(文件规模铁则);ipc.ts `export *` 转发,
 * 消费方 import 路径不变,仍是 @kernel/ipc。
 *
 * E_* 错误前缀:E_NOT_A_REPO / E_EMPTY / E_GIT2 / E_SHELL / E_AUTH,
 * 前端 startsWith 匹配,勿 grep 中文文案。
 */

/** 单文件工作区状态;status "?" 即 untracked(UI 渲染为 U)。 */
export interface GitFileStatus {
  path: string;
  /** "?" 即 untracked(UI 渲染为 U);"C" 即合并冲突(UI 禁 stage/discard) */
  status: "M" | "A" | "D" | "R" | "T" | "C" | "?";
  /** index 侧有变更(已暂存) */
  staged: boolean;
  /** 工作区侧有变更;staged && wt = 暂存后又改,预览/提交以 wt 侧为准 */
  wt: boolean;
  /** rename 来源路径(仓库相对);非 rename 为 null —— 目录列显示「← 旧目录/」 */
  oldPath: string | null;
}

export interface GitDiffStatus {
  /** 分支名;detached 时为 "detached@<短sha>" */
  branch: string;
  headSha: string;
  upstream: string | null;
  files: GitFileStatus[];
}

/** 每文件单侧 ±行数(staged 标记侧别:tree→index / index→workdir)。
 *  binary 不入列;untracked 整文件计入 wt 侧;聚合值恒等于逐项求和。 */
interface GitFileTotal {
  path: string;
  staged: boolean;
  insertions: number;
  deletions: number;
}

/** 聚合 ±行数 —— 独立低频命令(写操作后/手动刷新),不随 5s 轮询。 */
export interface GitTotals {
  insertions: number;
  deletions: number;
  files: GitFileTotal[];
}

export interface GitAheadBehind {
  ahead: number;
  behind: number;
  upstream: string | null;
}

/* ── 多仓发现(对齐 src-tauri/src/git/repos_scan.rs,serde camelCase)── */

/** 发现的单仓摘要;kind = 普通仓 / worktree / submodule(gitdir 指针分档)。 */
export interface GitRepoSummary {
  /** 绝对路径(输入 root 原始形态前缀;root 是仓时首个元素即 root) */
  path: string;
  /** 目录名 */
  name: string;
  /** HEAD shorthand;detached / unborn 为空串 */
  branch: string;
  kind: "repo" | "worktree" | "submodule";
}

export interface GitRepoScanResult {
  repos: GitRepoSummary[];
  /** 结果数超上限(32)被截断 */
  truncated: boolean;
}

export interface GitFilePatch {
  path: string;
  oldPath: string | null;
  kind: "A" | "D" | "M" | "R" | "C" | "T";
  binary: boolean;
  additions: number;
  deletions: number;
  patch: string;
}

/** 单提交改动清单项(git_commit_files;口径 = 提交 vs 首父,见 commit_view.rs)。 */
export interface GitCommitFile {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitCommitInput {
  message: string;
  amend: boolean;
}

export interface GitLogEntry {
  shortSha: string;
  longSha: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authorWhen: number;
  parentShas: string[];
  /** ref 装饰:HEAD -> main / main / origin/main / tag: v1(Rust 侧排序保证)。 */
  refs: string[];
}

export interface GitBranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  lastCommitSha: string;
  lastCommitSummary: string;
  lastCommitWhen: number;
}

export interface GitBranchList {
  local: GitBranchInfo[];
  remote: GitBranchInfo[];
}

/* ── 远端对话框(请求结构对齐 remote_ops.rs RemoteRequest,serde camelCase)── */

/** Gerrit 推送附加项;reviewers/cc 为逗号分隔用户名。 */
interface GerritExtra {
  topic: string | null;
  reviewers: string | null;
  cc: string | null;
}

/** 远端对话框结构化请求;op = "fetch" | "pull" | "push"。 */
export interface GitRemoteRequest {
  op: "fetch" | "pull" | "push";
  /** fetch:null = 全部远端;pull/push 必传(前端兜底 origin) */
  remote: string | null;
  /** pull:目标远端分支;push:目标远端分支 */
  branch: string | null;
  /** pull 单选:"--rebase" | "--ff-only" | "--no-ff" | "--squash" | null */
  strategy: string | null;
  noCommit: boolean;
  noVerify: boolean;
  forceWithLease: boolean;
  followTags: boolean;
  gerrit: GerritExtra | null;
}

/** 推送预览:HEAD 相对 <remote>/<branch> 的独有提交(targetFound=false = 新分支首推)。 */
export interface GitPushPreview {
  sourceBranch: string;
  targetFound: boolean;
  hasMore: boolean;
  commits: GitLogEntry[];
}

/** 分支对比:双向唯一提交(targetOnly = target 有 current 无;反向 currentOnly)。 */
export interface GitBranchCompareSet {
  targetOnly: GitLogEntry[];
  currentOnly: GitLogEntry[];
}

/** 工作树对分支的差异清单项(不带 patch;patch 按需单文件拉)。 */
export interface GitBranchDiffFile {
  path: string;
  /** rename/copy 来源路径;非 rename 为 null */
  oldPath: string | null;
  /** M / A / D / R / C / T(与 GitFileStatus.status 同口径) */
  status: string;
}
