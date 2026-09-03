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
}

export interface GitDiffStatus {
  /** 分支名;detached 时为 "detached@<短sha>" */
  branch: string;
  headSha: string;
  upstream: string | null;
  files: GitFileStatus[];
}

/** 聚合 ±行数 —— 独立低频命令(写操作后/手动刷新),不随 5s 轮询。 */
export interface GitTotals {
  insertions: number;
  deletions: number;
}

export interface GitAheadBehind {
  ahead: number;
  behind: number;
  upstream: string | null;
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
