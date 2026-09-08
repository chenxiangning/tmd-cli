/**
 * IPC 薄封装 —— 前端触达 Rust 后端的唯一入口。
 * 模式复用 mossx 的 services/tauri 分层，但砍到只剩直连。
 * Git 契约类型在 ./gitContract、SSH/SFTP 契约在 ./sshTypes(此处转发导出,消费方路径不变)。
 * file-size-exempt:R3 规定 @tauri-apps/* 唯一 import 点是本文件,fs/git/checkpoints/ssh
 * 四域 invoke 封装必须集中于此;契约类型已外拆,剩余为不可分散的命令面。
 */

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type {
  SftpEntry,
  SftpEventPayload,
  SftpReadText,
  SftpTransferState,
  SftpWriteOutcome,
  SshForwardInfo,
  SshHostConfig,
  SshPromptEvent,
  SshSessionEvent,
} from "./sshTypes";

export type {
  SftpEntry,
  SftpEventPayload,
  SftpReadText,
  SftpTransferState,
  SftpWriteOutcome,
  SshForwardInfo,
  SshHostConfig,
  SshPromptEvent,
  SshSessionEvent,
} from "./sshTypes";

export type * from "./gitContract";
import type {
  GitAheadBehind,
  GitBranchCompareSet,
  GitBranchDiffFile,
  GitBranchList,
  GitCommitFile,
  GitCommitInput,
  GitDiffStatus,
  GitFilePatch,
  GitLogEntry,
  GitPushPreview,
  GitRemoteRequest,
  GitRepoScanResult,
  GitTotals,
} from "./gitContract";

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  /** 会话后端类型:缺省 "cli";内置终端传 "shell"(Rust 侧 serde default 对齐)。
   *  "ssh" 不走 session_spawn(russh 有专属命令),不在本类型取值内。 */
  kind?: "cli" | "shell";
  /** 会话展示标题:缺省 None;内置终端传 shell 名(tab 条/侧栏直读)。 */
  title?: string;
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
  /** 会话后端类型:"cli"(本地 PTY,缺省)| "ssh"(russh 引擎)| "shell"(内置终端)。 */
  kind?: "cli" | "ssh" | "shell";
  /** 会话展示标题(SSH = 主机名;CLI 走磁盘会话/命名覆盖层,缺省无)。 */
  title?: string;
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

/** 参数化安装计划(对齐 src-tauri/src/installer.rs InstallPlan;camelCase tagged)。 */
export type CliInstallPlan =
  | { channel: "npm"; package: string }
  | { channel: "script"; unix: string; windows: string }
  /** 通用命令通道:program/args 由调用方传入,内核零配方(cli-omp 扩展装卸等)。 */
  | { channel: "command"; program: string; args: string[] };


/* ── checkpoints 契约(对齐 src-tauri/src/checkpoints/*,serde camelCase)── */

/** live 相对批后像:same 可回退 / changed 内容已变 / committed 已入 git / reverted 已退 */
export interface CkptBatchFile {
  path: string;
  status: string;
  reverted: boolean;
  live: "same" | "changed" | "committed" | "reverted";
  stale: boolean;
  /** 本轮 AI 写入事件计数(events 归因轨迹;git 归因 = 0) */
  editCount: number;
}

/** 锚点时刻的引擎状态快照(账本随批固化;空串 = 未知,UI 隐藏该段)。 */
export interface CkptAnchorMeta {
  /** 引擎显示名(如 "Claude Code") */
  engine: string;
  /** 发送时刻观测的模型 id */
  model: string;
  /** 发送时刻观测的思考强度 */
  thinking: string;
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
  /** 锚点时刻快照:引擎显示名 / 模型 / 思考强度(旧账本条目为空串,UI 隐藏) */
  engine: string;
  model: string;
  thinking: string;
  /** pending 待审 / approved 已通过(纯标记) / reverted 已退 / done 自动已处理 */
  state: "pending" | "approved" | "reverted" | "done";
  doneReason: string | null;
  guardId: string | null;
  files: CkptBatchFile[];
  /** 归因模式:"events"(AI 事件流)| "git"(窗口推断;UI 提示可信度) */
  attribution: "events" | "git";
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



/* ── proc_communicate 契约(对齐 src-tauri/src/proc_run.rs,serde camelCase)── */

export interface ProcRunSpec {
  /** 程序名(PATH 解析与 PTY 同源)或绝对路径。 */
  command: string;
  args: string[];
  /** 工作目录(CLI 按此发现项目级扩展/技能)。 */
  cwd: string;
  /** 附加环境变量(叠加在继承环境之上)。 */
  env?: Record<string, string>;
  /** 启动后一次性写入 stdin;写入后管道保持打开,直到收割(kill/退出)。 */
  stdin?: string;
  /** stdin 以 null 启动(立即 EOF)。一次性 CLI(omp -p 等)检测到管道 stdin 会等 EOF 挂死;RPC 副车勿开。 */
  closeStdin?: boolean;
  /** stdout 出现该子串即提前收割(响应已到达,不等满超时)。 */
  exitOnStdout?: string;
  timeoutMs: number;
}

export interface ProcRunResult {
  stdout: string;
  stderr: string;
  /** 退出码;被强杀时可能为 null(信号终止)。 */
  code: number | null;
  /** true = 超时强杀;false = exitOnStdout 命中或进程自然退出。 */
  timedOut: boolean;
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
  /** 项目文件索引(composer @ 补全候选):递归 + gitignore/.ignore/.fdignore,
   *  跳 dotfiles/node_modules,返回 root 相对 posix 路径(排序稳定);cap = 上限。
   *  语义镜像 pi/omp TUI 自己的 @ 发现规则(见 fs_walk.rs)。 */
  fsWalkFiles: (root: string, cap: number) => invoke<string[]>("fs_walk_files", { root, cap }),
  /** 通用短进程通道:spawn + stdin(写入后持开防 RPC 丢响应)+ stdout 收割;
   *  exitOnStdout 命中或超时即杀。omp/pi RPC 副车、grok inspect 共用(见 proc_run.rs)。 */
  procCommunicate: (spec: ProcRunSpec) => invoke<ProcRunResult>("proc_communicate", { spec }),
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
  readBinaryFileBase64: (path: string) => invoke<string>("read_binary_file_base64", { path }),
  /* ── git(右栏面板;cwd 由调用方从活跃 workspace 取)── */
  gitStatus: (cwd: string) => invoke<GitDiffStatus>("git_status", { cwd }),
  /** 多仓发现:root 下 BFS 找 .git(深度上限 maxDepth,前端默认 2);
   *  结果按 path 排序,root 是仓时首个即 root;超 32 截断(truncated)。 */
  gitReposScan: (root: string, maxDepth: number) =>
    invoke<GitRepoScanResult>("git_repos_scan", { root, maxDepth }),

  /* ── checkpoints(批次审批/回退;契约对齐 src-tauri/src/checkpoints/*,serde camelCase)
   * E_* 前缀:E_NOT_A_REPO / E_EMPTY / E_STORE / E_GIT2 / E_IO ── */
  /** 记第 N 轮锚点(隐式封上一轮 + CLI 身份回填);失败不阻塞发送(调用方 catch 重试一次)。
   *  meta = 发送时刻的引擎/模型/思考强度快照,随锚点固化进账本;
   *  attribution = 归因模式(profile.editMarks 声明派生:"events" | "git")。 */
  checkpointAnchor: (
    cwd: string,
    sessionId: string,
    tmdSessionId: string,
    prompt: string,
    meta: CkptAnchorMeta,
    attribution?: "events" | "git",
  ) =>
    invoke<string>("checkpoint_anchor", {
      cwd,
      sessionId,
      tmdSessionId,
      prompt,
      engine: meta.engine,
      model: meta.model,
      thinking: meta.thinking,
      attribution: attribution ?? "git",
    }),
  /** AI 写入事件流式记账(EditWatch / 会话磁盘事件拉取命中即调)。
   *  ts = 写入事件时刻(磁盘事件源携带;PTY 标记无时刻传 null),Rust 侧
   *  以它守卫迟到事件(早于锚点 = 上一轮尾巴,丢弃)。返回是否入账。 */
  checkpointRecordEdit: (
    cwd: string,
    sessionId: string,
    tmdSessionId: string,
    path: string,
    ts: number | null,
  ) => invoke<boolean>("checkpoint_record_edit", { cwd, sessionId, tmdSessionId, path, ts }),
  /** 显式封口(一轮对话结算):把最新锚点以来的变更固化成账本 turn 条目。 */
  checkpointSeal: (cwd: string, sessionId: string, tmdSessionId: string) =>
    invoke<boolean>("checkpoint_seal", { cwd, sessionId, tmdSessionId }),
  /** 死锚点收口(强退恢复):上一运行被 kill 的会话没有 sessionExited,
   *  最后一轮仍是开放锚点 —— 此命令按 cwd 把超过 graceMs 的开放锚点代为
   *  封口。graceMs 保护本运行刚打的在途锚点。返回本次封口的锚点数。 */
  checkpointSealDead: (cwd: string, graceMs: number) =>
    invoke<number>("checkpoint_seal_dead", { cwd, graceMs }),
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
  /** 应用:把账本固化的批后像精确写回磁盘(回退的镜像);守卫可反悔。 */
  checkpointApply: (cwd: string, batchId: string, paths?: string[]) =>
    invoke<CkptRestoreOutcome>("checkpoint_apply", { cwd, batchId, paths: paths ?? null }),
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
  /** 单提交文件清单(历史 Graph 展开;sha 口径 = 提交 vs 首父)。 */
  gitCommitFiles: (cwd: string, sha: string) =>
    invoke<GitCommitFile[]>("git_commit_files", { cwd, sha }),
  /** 提交内单文件 patch;path 按 新路径/rename 来源 匹配。 */
  gitCommitFilePatch: (cwd: string, sha: string, path: string) =>
    invoke<GitFilePatch | null>("git_commit_file_patch", { cwd, sha, path }),
  /** 提交完整 message(首行+正文;分支对比详情面板)。 */
  gitCommitMessage: (cwd: string, sha: string) =>
    invoke<string>("git_commit_message", { cwd, sha }),
  gitBranches: (cwd: string) => invoke<GitBranchList>("git_branches", { cwd }),
  gitCheckout: (cwd: string, name: string) =>
    invoke<void>("git_checkout", { cwd, name }),
  /** 检出远程分支为本地同名分支并建跟踪(origin/feat → feat + upstream)。 */
  gitCheckoutRemote: (cwd: string, name: string) =>
    invoke<void>("git_checkout_remote", { cwd, name }),
  gitCreateBranch: (cwd: string, name: string, from?: string) =>
    invoke<void>("git_create_branch", { cwd, name, from: from ?? null }),
  gitDeleteBranch: (cwd: string, name: string, force: boolean) =>
    invoke<void>("git_delete_branch", { cwd, name, force }),
  /** 合并分支到当前分支(冲突留 MERGE_HEAD 中间态,幕布终端可接管)。 */
  gitMergeBranch: (cwd: string, name: string) =>
    invoke<void>("git_merge_branch", { cwd, name }),
  /** 当前分支变基到 onto(冲突留 rebase-merge 中间态)。 */
  gitRebaseBranch: (cwd: string, onto: string) =>
    invoke<void>("git_rebase_branch", { cwd, onto }),
  /** 重命名本地分支(git branch -m;upstream 配置随迁)。 */
  gitRenameBranch: (cwd: string, oldName: string, newName: string) =>
    invoke<void>("git_rename_branch", { cwd, oldName, newName }),
  /** 分支对比:双向唯一提交(limit 缺省 200,clamp 1..500)。低频,菜单触发。 */
  gitBranchCompare: (cwd: string, target: string, current: string, limit?: number) =>
    invoke<GitBranchCompareSet>("git_branch_compare", {
      cwd,
      target,
      current,
      limit: limit ?? null,
    }),
  /** 工作树对分支的差异文件清单(不带 patch)。 */
  gitBranchWorktreeFiles: (cwd: string, branch: string) =>
    invoke<GitBranchDiffFile[]>("git_branch_worktree_files", { cwd, branch }),
  /** 工作树对分支的单文件 patch(path 按 新路径/rename 来源 匹配)。 */
  gitBranchWorktreePatch: (cwd: string, branch: string, path: string) =>
    invoke<GitFilePatch | null>("git_branch_worktree_patch", { cwd, branch, path }),
  gitFetch: (cwd: string) => invoke<string>("git_fetch", { cwd }),
  /** pull/push/fetch 统一入口;branch 缺省作用于当前分支(fetch 缺省 = --all --prune)。
   *  pull 非当前分支 = 仅 fast-forward 上游引用;fetch 带分支 = 刷新该分支上游引用。 */
  gitPullPush: (cwd: string, op: "pull" | "push" | "fetch", branch?: string) =>
    invoke<string>("git_pull_push", { cwd, op, branch: branch ?? null }),
  /** 已配置远端名列表(推送/拉取对话框远端下拉)。 */
  gitRemotes: (cwd: string) => invoke<string[]>("git_remotes", { cwd }),
  /** 推送预览:HEAD 相对 <remote>/<branch> 的独有提交;低频,仅在对话框内按需拉。 */
  gitPushPreview: (cwd: string, remote: string, branch: string, limit?: number) =>
    invoke<GitPushPreview>("git_push_preview", { cwd, remote, branch, limit: limit ?? null }),
  /** 远端对话框结构化请求(带选项);pull 移动 HEAD。 */
  gitRemoteRequest: (cwd: string, req: GitRemoteRequest) =>
    invoke<string>("git_remote_request", { cwd, req }),
  /** 「暂存并切换」(IDEA Smart Checkout):脏工作区 stash -u → 切换 → pop,
   *  pop 冲突时切换已生效、stash 保留;remote = 检出远程分支版。 */
  gitSmartCheckout: (cwd: string, name: string, remote: boolean) =>
    invoke<void>("git_smart_checkout", { cwd, name, remote }),
  /** 还原一次「暂存并切换」:reset --hard 清冲突 → 切回 original → 恢复 stash。 */
  gitSmartCheckoutUndo: (cwd: string, original: string) =>
    invoke<void>("git_smart_checkout_undo", { cwd, original }),
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
  /** 通用只读 sqlite 查询(参数化绑定,READ_ONLY 连接)。
   *  CLI 私有库的路径/表结构知识在插件侧(cli-shared),内核只做代读原语。 */
  sqliteQuery: (dbPath: string, sql: string, params: string[]) =>
    invoke<unknown[][]>("sqlite_query", { dbPath, sql, params }),
  /** 通用参数化 sqlite 写执行(单条语句;连接启用 FK 级联 + 3s busy 超时)。
   *  CLI 私有库的代写原语(单库 CLI 的会话删除等),SQL 知识在插件侧;
   *  库不存在/执行失败 = 裸字符串错误(调用方提示)。 */
  sqliteExecute: (dbPath: string, sql: string, params: string[]) =>
    invoke<void>("sqlite_execute", { dbPath, sql, params }),
  /** 读取非空环境变量;用于 pi auth.json 的 $ENV_VAR 凭据引用。 */
  quotaEnvValue: (name: string) =>
    invoke<string | null>("quota_env_value", { name }),
  /** 探针 CLI 是否在本机 PATH 中可解析(以及 `--version` 输出)。 */
  cliProbe: (command: string) =>
    invoke<CliProbeResult>("cli_probe", { command }),
  /** 一键安装 CLI(计划由 CliProfile 安装元数据派生:scriptInstall 优先,否则 npm);
   *  日志经 cli-install://{id} 事件推,id 惯例 = 引擎 binary。 */
  cliInstallRun: (id: string, plan: CliInstallPlan) =>
    invoke<boolean>("cli_install_run", { id, plan }),
  /** 字符串 MD5(小写 hex)。kimi 会话目录按 MD5(cwd) 命名,前端据此拼会话路径。 */
  md5Hex: (text: string) => invoke<string>("md5_hex", { text }),

  /* ── SSH(对齐 src-tauri/src/ssh/commands.rs;输出/翻页走上方 session_* 按 kind 路由)── */
  /** 创建 SSH 会话:立即返回 id,连接/认证后台完成(ssh://event / ssh://prompt)。 */
  sshSessionCreate: (
    host: SshHostConfig,
    cwd: string,
    workspaceId?: string,
    cols?: number,
    rows?: number,
  ) =>
    invoke<SpawnedSession>("ssh_session_create", {
      host,
      cwd,
      workspaceId: workspaceId ?? null,
      cols: cols ?? null,
      rows: rows ?? null,
    }),
  /** 重连 SSH 会话:后端取原主机配置(凭据不出后端)收尾旧会话后同配置新建,新会话新 id。 */
  sshSessionReconnect: (sessionId: string, cwd: string, workspaceId?: string) =>
    invoke<SpawnedSession>("ssh_session_reconnect", {
      sessionId,
      cwd,
      workspaceId: workspaceId ?? null,
    }),
  /** 会话当前状态(webview 重载后重建面板状态用)。 */
  sshSessionStatus: (sessionId: string) =>
    invoke<string>("ssh_session_status", { sessionId }),
  /** 提示应答:hostKey 传 trustHostKey;kbi/password 传 answer。 */
  sshPromptAnswer: (promptId: string, answer?: string, trustHostKey?: boolean) =>
    invoke<void>("ssh_prompt_answer", {
      promptId,
      answer: answer ?? null,
      trustHostKey: trustHostKey ?? false,
    }),
  /** 提示取消(等价拒绝)。 */
  sshPromptCancel: (promptId: string) =>
    invoke<void>("ssh_prompt_cancel", { promptId }),
  /** 延迟探测(右栏面板轮询)。 */
  sshLatency: (sessionId: string) => invoke<number>("ssh_latency", { sessionId }),
  /** 重置某主机的 known_hosts 信任(设置页「忘记此主机」)。 */
  sshKnownHostsReset: (host: string, port: number) =>
    invoke<boolean>("ssh_known_hosts_reset", { host, port }),

  /* ── SFTP ── */
  sftpList: (sessionId: string, path?: string) =>
    invoke<SftpEntry[]>("ssh_sftp_list", { sessionId, path: path ?? null }),
  sftpStat: (sessionId: string, path: string) =>
    invoke<SftpEntry | null>("ssh_sftp_stat", { sessionId, path }),
  sftpReadText: (sessionId: string, path: string, offset?: number, maxBytes?: number) =>
    invoke<SftpReadText>("ssh_sftp_read_text", {
      sessionId,
      path,
      offset: offset ?? null,
      maxBytes: maxBytes ?? null,
    }),
  /** 写回带乐观并发:expectedMtime/expectedSize 不符返回 action=conflict。 */
  sftpWriteText: (
    sessionId: string,
    path: string,
    content: string,
    expectedMtime?: number,
    expectedSize?: number,
  ) =>
    invoke<SftpWriteOutcome>("ssh_sftp_write_text", {
      sessionId,
      path,
      content,
      expectedMtime: expectedMtime ?? null,
      expectedSize: expectedSize ?? null,
    }),
  sftpMkdir: (sessionId: string, path: string) =>
    invoke<SftpEntry>("ssh_sftp_mkdir", { sessionId, path }),
  sftpRename: (sessionId: string, fromPath: string, toPath: string) =>
    invoke<SftpEntry>("ssh_sftp_rename", { sessionId, fromPath, toPath }),
  sftpDelete: (sessionId: string, path: string, recursive?: boolean) =>
    invoke<void>("ssh_sftp_delete", {
      sessionId,
      path,
      recursive: recursive ?? false,
    }),
  /** 启动上传/下载(后台任务 + ssh://sftp 进度事件);返回 queued 初始态。 */
  sftpTransfer: (
    sessionId: string,
    direction: "upload" | "download",
    sourcePath: string,
    targetPath: string,
    recursive?: boolean,
  ) =>
    invoke<SftpTransferState>("ssh_sftp_transfer", {
      sessionId,
      direction,
      sourcePath,
      targetPath,
      recursive: recursive ?? false,
    }),
  sftpTransferCancel: (sessionId: string, transferId: string) =>
    invoke<void>("ssh_sftp_transfer_cancel", { sessionId, transferId }),
  sftpTransferStatus: (sessionId: string, transferId: string) =>
    invoke<SftpTransferState>("ssh_sftp_transfer_status", { sessionId, transferId }),

  /* ── SSH 本地端口转发(-L)── */
  sshForwardStart: (
    sessionId: string,
    remoteHost: string,
    remotePort: number,
    localPort?: number,
  ) =>
    invoke<SshForwardInfo>("ssh_forward_start", {
      sessionId,
      remoteHost,
      remotePort,
      localPort: localPort ?? null,
    }),
  sshForwardStop: (sessionId: string, forwardId: string) =>
    invoke<void>("ssh_forward_stop", { sessionId, forwardId }),
  sshForwardList: (sessionId: string) =>
    invoke<SshForwardInfo[]>("ssh_forward_list", { sessionId }),
  /** 本地端口占用预检(advisory;start 的 bind 才是权威)。 */
  sshForwardCheckPort: (port: number) => invoke<boolean>("ssh_forward_check_port", { port }),
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

/** 界面缩放:webview 整页 zoom(mac pageZoom / win zoomFactor / gtk zoom_level)。
 *  需 capability core:webview:allow-set-webview-zoom;浏览器环境 reject 由 kernel/uiZoom 兜底。 */
export function setWebviewZoom(factor: number): Promise<void> {
  return getCurrentWebview().setZoom(factor);
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

/** 文件选择对话框(上传等需要本地文件路径的场景);取消返回 null。 */
export function pickFile(title: string): Promise<string | null> {
  return openDialog({ directory: false, multiple: false, title });
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
  /** true = 响应按原始文本返回(body 为字符串),跳过 JSON 解析(如 atom/xml 源)。 */
  text?: boolean;
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

/** 订阅某 SSH 会话的状态/转发快照事件。返回退订函数。 */
export function onSshSessionEvent(sessionId: string, cb: (e: SshSessionEvent) => void) {
  return listen<SshSessionEvent>(`ssh://event/${sessionId}`, (ev) => cb(ev.payload));
}

/** 订阅某 SSH 会话的认证/host key 提示。返回退订函数。 */
export function onSshPrompt(sessionId: string, cb: (e: SshPromptEvent) => void) {
  return listen<SshPromptEvent>(`ssh://prompt/${sessionId}`, (ev) => cb(ev.payload));
}

/** 订阅 SFTP 传输进度/终态(全局通道,按 payload.transfer.sessionId 归属)。 */
export function onSftpEvent(cb: (e: SftpEventPayload) => void) {
  return listen<SftpEventPayload>("ssh://sftp", (ev) => cb(ev.payload));
}
