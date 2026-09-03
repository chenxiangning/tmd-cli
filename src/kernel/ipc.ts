/**
 * IPC 薄封装 —— 前端触达 Rust 后端的唯一入口。
 * 模式复用 mossx 的 services/tauri 分层，但砍到只剩直连。
 */

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface SpawnedSession {
  id: string;
  pid?: number;
}

/** 幕布翻页结果。startOffset 为全量输出的绝对字节偏移(含已截断部分)。 */
export interface HistoryPage {
  text: string;
  startOffset: number;
  hasMore: boolean;
}

export interface SessionMeta {
  id: string;
  profileId: string;
  cwd: string;
  pid?: number;
  workspaceId?: string;
  createdAt?: number;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  root: string;
  createdAt: number;
}

export interface WorkspacesFile {
  list: WorkspaceMeta[];
  activeId?: string | null;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** 带修改时间的文件条目 —— fsCollectFiles 返回,供 CLI 磁盘会话扫描。 */
export interface FileStamp {
  name: string;
  path: string;
  modifiedAt: number;
}

/* ── Git 契约(对齐 src-tauri/src/git/*,serde camelCase)──
 * E_* 错误前缀:E_NOT_A_REPO / E_EMPTY / E_GIT2 / E_SHELL / E_AUTH,
 * 前端 startsWith 匹配,勿 grep 中文文案。 */

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

export interface GitCommitInput {
  message: string;
  amend: boolean;
}

/* ── checkpoints 契约(对齐 src-tauri/src/checkpoints/*,serde camelCase)── */

/** live 相对批后像:same 可回退 / changed 内容已变 / committed 已入 git / reverted 已退 */
export interface CkptBatchFile {
  path: string;
  status: string;
  reverted: boolean;
  live: "same" | "changed" | "committed" | "reverted";
  stale: boolean;
}

export interface CkptBatch {
  id: string;
  /** 会话内 1-based 轮次(账本记录;纯阅读轮缺号 = 真实轮次) */
  index: number;
  open: boolean;
  ts: number;
  tsEnd: number | null;
  sessionId: string;
  prompt: string;
  /** pending 待审 / approved 已通过(纯标记) / reverted 已退 / done 自动已处理 */
  state: "pending" | "approved" | "reverted" | "done";
  doneReason: string | null;
  guardId: string | null;
  files: CkptBatchFile[];
}

export interface CkptPatch {
  path: string;
  kind: "A" | "D" | "M";
  additions: number;
  deletions: number;
  patch: string;
  binary: boolean;
}

export interface CkptSkipEntry {
  path: string;
  reason: string;
}

export interface CkptRestoreOutcome {
  restored: string[];
  deleted: string[];
  skipped: CkptSkipEntry[];
  guardId: string | null;
  state: "pending" | "reverted";
}

export interface GitLogEntry {
  shortSha: string;
  longSha: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authorWhen: number;
  parentShas: string[];
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

export const ipc = {
  sessionSpawn: (profileId: string, spec: SpawnSpec, workspaceId?: string) =>
    invoke<SpawnedSession>("session_spawn", { profileId, spec, workspaceId: workspaceId ?? null }),
  sessionList: () => invoke<SessionMeta[]>("session_list"),
  sessionWrite: (id: string, data: string) =>
    invoke<void>("session_write", { id, data }),
  sessionResize: (id: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { id, cols, rows }),
  sessionKill: (id: string) => invoke<void>("session_kill", { id }),
  /** 会话输出日志的绝对末尾偏移(累计字节数);无日志返回 0。 */
  sessionLogSize: (id: string) => invoke<number>("session_log_size", { id }),
  /** 幕布往前翻页:before 绝对偏移之前最多 maxBytes 字节的原始输出。 */
  sessionHistoryPage: (id: string, before: number, maxBytes: number) =>
    invoke<HistoryPage>("session_history_page", { id, before, maxBytes }),
  fsListDir: (path: string) => invoke<DirEntry[]>("fs_list_dir", { path }),
  fsWriteTemp: (name: string, data: Uint8Array) =>
    invoke<string>("fs_write_temp", { name, data: Array.from(data) }),
  fsReadFile: (path: string) => invoke<string>("fs_read_file", { path }),
  /* ── 文件编辑/管理写操作(右键菜单 + 编辑器保存;对齐 src-tauri/src/fs_edit.rs)── */
  /** 覆写文本文件(编辑器保存通道)。后端拒绝相对路径与 .git 段。 */
  fsWriteFile: (path: string, content: string) =>
    invoke<void>("fs_write_file", { path, content }),
  /** 新建空文件;同名(文件/目录)已存在报错,绝不覆写 —— 新建走这里,不走 fsWriteFile。 */
  fsCreateFile: (path: string) => invoke<void>("fs_create_file", { path }),
  /** 新建文件夹;同名已存在报错。 */
  fsCreateDir: (path: string) => invoke<void>("fs_create_dir", { path }),
  /** 同目录内改名;返回新绝对路径;目标撞名报错。 */
  fsRenameEntry: (path: string, newName: string) =>
    invoke<string>("fs_rename_entry", { path, newName }),
  /** 移入系统废纸篓;路径不存在幂等成功。 */
  fsTrashEntry: (path: string) => invoke<void>("fs_trash_entry", { path }),
  /** 在系统文件管理器中显示并选中(macOS Finder / Win 资源管理器)。 */
  fsRevealInFileManager: (path: string) =>
    invoke<void>("fs_reveal_in_file_manager", { path }),
  /** 本地图片 → data URL(markdown 预览 asset:// 失败回退;Rust 侧白名单+大小闸)。 */
  readLocalImageDataUrl: (path: string) =>
    invoke<string>("read_local_image_data_url", { path }),
  /* ── git(右栏面板;cwd 由调用方从活跃 workspace 取)── */
  gitStatus: (cwd: string) => invoke<GitDiffStatus>("git_status", { cwd }),

  /* ── checkpoints(批次审批/回退;契约对齐 src-tauri/src/checkpoints/*,serde camelCase)
   * E_* 前缀:E_NOT_A_REPO / E_EMPTY / E_STORE / E_GIT2 / E_IO ── */

  /** 记第 N 轮锚点(隐式封上一轮 + CLI 身份回填);失败不阻塞发送(调用方 catch 重试一次)。 */
  checkpointAnchor: (cwd: string, sessionId: string, tmdSessionId: string, prompt: string) =>
    invoke<string>("checkpoint_anchor", { cwd, sessionId, tmdSessionId, prompt }),
  /** 显式封口(一轮对话结算):把最新锚点以来的变更固化成账本 turn 条目。 */
  checkpointSeal: (cwd: string, sessionId: string, tmdSessionId: string) =>
    invoke<boolean>("checkpoint_seal", { cwd, sessionId, tmdSessionId }),
  /** 批次清单(账本只读视图;session 严格隔离);按需调用,勿挂轮询。 */
  checkpointList: (cwd: string, sessionId: string, tmdSessionId?: string) =>
    invoke<CkptBatch[]>("checkpoint_list", { cwd, sessionId, tmdSessionId: tmdSessionId ?? "" }),
  /** 批次逐文件 unified patch(sealed 读账本固化的 diff,open 批新像 = live 现算)。 */
  checkpointBatchDiff: (cwd: string, batchId: string) =>
    invoke<CkptPatch[]>("checkpoint_batch_diff", { cwd, batchId }),
  /** 通过标记:纯标记,不动文件/不碰 git;approved 批仍可回退。 */
  checkpointApprove: (cwd: string, batchId: string) =>
    invoke<void>("checkpoint_approve", { cwd, batchId }),
  /** 回退整批或子集;返回恢复点 id 供反悔。 */
  checkpointRestore: (cwd: string, batchId: string, paths?: string[]) =>
    invoke<CkptRestoreOutcome>("checkpoint_restore", { cwd, batchId, paths: paths ?? null }),
  /** 反悔:用守卫快照写回回退前状态。 */
  checkpointUndoRevert: (cwd: string, batchId: string) =>
    invoke<CkptRestoreOutcome>("checkpoint_undo_revert", { cwd, batchId }),
  /** 保留策略清理(低频)。返回删除的批次数。 */
  checkpointPrune: (cwd: string, keep: number, ttlDays: number) =>
    invoke<number>("checkpoint_prune", { cwd, keep, ttlDays }),

  /** 低频:聚合 ±行数(全仓 diff×2),仅在写操作后/手动刷新拉,勿挂轮询。 */
  gitTotals: (cwd: string) => invoke<GitTotals>("git_totals", { cwd }),
  /** 低频:ahead/behind 仅在 fetch/切分支/手动刷新后拉,勿挂轮询。 */
  gitAheadBehind: (cwd: string) => invoke<GitAheadBehind>("git_ahead_behind", { cwd }),
  gitDiffFilePatch: (cwd: string, path: string, staged: boolean) =>
    invoke<GitFilePatch | null>("git_diff_file_patch", { cwd, path, staged }),
  gitStage: (cwd: string, paths: string[]) =>
    invoke<void>("git_stage", { cwd, paths }),
  gitUnstage: (cwd: string, paths: string[]) =>
    invoke<void>("git_unstage", { cwd, paths }),
  /** 还原已跟踪文件到 HEAD;untracked 不动。 */
  gitDiscard: (cwd: string, paths: string[]) =>
    invoke<void>("git_discard", { cwd, paths }),
  /** 勾选提交:paths 非空先 stage 再 commit,单次 IPC 原子完成。 */
  gitCommit: (cwd: string, paths: string[], input: GitCommitInput) =>
    invoke<string>("git_commit", { cwd, paths, input }),
  gitLog: (cwd: string, limit: number, offset: number) =>
    invoke<GitLogEntry[]>("git_log", { cwd, limit, offset }),
  gitBranches: (cwd: string) => invoke<GitBranchList>("git_branches", { cwd }),
  gitCheckout: (cwd: string, name: string) =>
    invoke<void>("git_checkout", { cwd, name }),
  gitCreateBranch: (cwd: string, name: string, from?: string) =>
    invoke<void>("git_create_branch", { cwd, name, from: from ?? null }),
  gitDeleteBranch: (cwd: string, name: string, force: boolean) =>
    invoke<void>("git_delete_branch", { cwd, name, force }),
  gitFetch: (cwd: string) => invoke<string>("git_fetch", { cwd }),
  /** pull/push 统一入口;凭据失败返 E_AUTH:,引导用户去幕布终端。 */
  gitPullPush: (cwd: string, op: "pull" | "push", branch?: string) =>
    invoke<string>("git_pull_push", { cwd, op, branch: branch ?? null }),
  /** 递归收集目录下指定后缀文件,按修改时间倒序。目录不存在 = 空表。 */
  fsCollectFiles: (dir: string, suffix: string) =>
    invoke<FileStamp[]>("fs_collect_files", { dir, suffix }),
  /** 读取文件尾部 maxBytes 字节,供 session 状态增量解析。 */
  fsReadTail: (path: string, maxBytes: number) =>
    invoke<string>("fs_read_tail", { path, maxBytes }),
  /** 读文件头部 maxBytes 字节(解析 jsonl 首行 meta 用,避免全文加载)。 */
  fsReadHead: (path: string, maxBytes: number) =>
    invoke<string>("fs_read_head", { path, maxBytes }),
  /** 物理删除文件或目录(会话列表"删除会话"用);kimi 会话是目录,统一走此命令。
   *  路径不存在视为成功(幂等)。 */
  fsRemovePath: (path: string) => invoke<void>("fs_remove_path", { path }),
  configHomeDir: () => invoke<string>("config_home_dir"),
  /** 默认工作区根目录(~/.tmd-cli/default,Rust 侧已确保存在,mac/win 兼容)。 */
  configDefaultWorkspaceRoot: () =>
    invoke<string>("config_default_workspace_root"),
  configReadWorkspaces: () => invoke<WorkspacesFile>("config_read_workspaces"),
  configWriteWorkspaces: (data: WorkspacesFile) =>
    invoke<void>("config_write_workspaces", { data }),
  /** 读全局设置(~/.tmd-cli/settings.json);文件不存在/损坏返回 null,前端 sanitize 兜底。 */
  configReadSettings: () => invoke<unknown>("config_read_settings"),
  /** 整棵写全局设置;schema 归 kernel/settings.ts,Rust 仅透传。 */
  configWriteSettings: (data: unknown) =>
    invoke<void>("config_write_settings", { data }),
  /** 通用 HTTP 代理 ─ 各 CLI quota provider 通过此调用供应商 API。 */
  quotaFetch: (spec: QuotaFetchSpec) =>
    invoke<QuotaFetchResponse>("quota_fetch", { spec }),
  /** 读 omp CLI 某供应商最新凭据 data JSON(~/.omp/agent/agent.db,只读);无记录返回 null。 */
  ompAuthCredential: (provider: string) =>
    invoke<string | null>("omp_auth_credential", { provider }),
  /** 读取非空环境变量;用于 pi auth.json 的 $ENV_VAR 凭据引用。 */
  quotaEnvValue: (name: string) =>
    invoke<string | null>("quota_env_value", { name }),

  /** 探针 CLI 是否在本机 PATH 中可解析(以及 `--version` 输出)。 */
  cliProbe: (command: string) =>
    invoke<CliProbeResult>("cli_probe", { command }),
  /** 一键安装 CLI(claude 官方 native,其余 npm -g);日志经 cli-install://{engine} 事件推。 */
  cliInstallRun: (engine: string) =>
    invoke<boolean>("cli_install_run", { engine }),
  /** 字符串 MD5(小写 hex)。kimi 会话目录按 MD5(cwd) 命名,前端据此拼会话路径。 */
  md5Hex: (text: string) => invoke<string>("md5_hex", { text }),
  /** 列出 omp 已登录的供应商 id 列表(agent.db auth_credentials,未禁用)。 */
  ompAuthProviders: () => invoke<string[]>("omp_auth_providers"),
 };
/* ── Tauri API 统一收口 ──
 * 架构铁律:前端任何 @tauri-apps/* import 只允许出现在本文件。
 * 以下为非 invoke 通道的 Tauri 能力(窗口控制/版本/系统对话框),同样在此薄封装。 */

/** 平台标识兜底:UA 探测异常时取 Rust std::env::consts::OS。 */
export function platformKind(): Promise<string> {
  return invoke<string>("platform_kind");
}

/** 窗口最小化(自绘 titlebar 用;macOS 系统红绿灯下不会被调用)。 */
export function windowMinimize(): Promise<void> {
  return getCurrentWindow().minimize();
}

/** 窗口最大化/还原切换。 */
export function windowToggleMaximize(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

/** 关闭窗口。 */
export function windowClose(): Promise<void> {
  return getCurrentWindow().close();
}

/** 应用版本号(关于/设置页脚展示)。 */
export function appVersion(): Promise<string> {
  return getVersion();
}

/** 重启应用(插件市场"拔插 = 重启生效"的一键入口;浏览器 dev 无 Tauri runtime,调用方需兜底)。 */
export function appRestart(): Promise<void> {
  return invoke<void>("app_restart");
}

/** 目录选择对话框;返回绝对路径,取消返回 null。 */
export function pickDirectory(title: string): Promise<string | null> {
  return openDialog({ directory: true, multiple: false, title });
}

/** 系统默认浏览器打开外链;浏览器 dev 无 shell 插件时回退 window.open。 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await shellOpen(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** 本地文件路径 → asset:// URL(markdown 预览本地图片)。 */
export function assetUrl(path: string): string {
  return convertFileSrc(path);
}

export interface QuotaFetchSpec {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface QuotaFetchResponse {
  status: number;
  body: unknown;
}

/** 安装事件 payload(对齐 installer.rs CliInstallEvent)。 */
export interface CliInstallEvent {
  stream: "stdout" | "stderr" | "phase";
  text: string;
}

/** 后端 `cli_probe` command 返回结构(对齐 src-tauri/src/probe.rs)。 */
export interface CliProbeResult {
  command: string;
  found: boolean;
  path: string | null;
  version: string | null;
}

/** 订阅某引擎的安装事件流。返回退订函数。 */
export function onCliInstallEvent(
  engine: string,
  cb: (e: CliInstallEvent) => void,
) {
  return listen<CliInstallEvent>(`cli-install://${engine}`, (ev) => cb(ev.payload));
}

/** 订阅某会话的 PTY 输出流。返回退订函数。 */
export function onPtyOutput(sessionId: string, cb: (text: string) => void) {
  return listen<string>(`pty://out/${sessionId}`, (e) => cb(e.payload));
}

/** 订阅某会话的进程退出。返回退订函数。 */
export function onPtyExit(sessionId: string, cb: () => void) {
  return listen(`pty://exit/${sessionId}`, () => cb());
}
