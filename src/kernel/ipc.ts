/**
 * IPC 薄封装 —— 前端触达 Rust 后端的唯一入口。
 * 模式复用 mossx 的 services/tauri 分层,但砍到只剩直连。
 * Git 契约类型在 ./gitContract、SSH/SFTP 契约在 ./sshTypes(此处转发导出,消费方路径不变)。
 * file-size-exempt:R3 规定 @tauri-apps/* 唯一 import 点是 ./transport(本文件继承);
 * fs/git/checkpoints/ssh 四域 invoke 封装必须集中于此;契约类型已外拆,剩余为不可分散的命令面。
 * 另有 wsl_* 命令族:语义归 wsl 来源插件(kernel 零 WSL 语义,解释权在插件),
 * 因 R3 同样必须经本文件 invoke,故与四域并列集中;权限面归 ipc.exec 泛化类。
 * 浏览器态(isWeb)下 invoke/listen 由 transport 自动切 WS 桥;纯桌面 API
 * (窗口/对话框/更新器)在本文件按 isWeb 降级(见尾部各包装注释)。
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke, listen, webToken, isWeb, serverVersion } from "./transport";
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
import type { OpenWithTarget } from "./settingsTypes";

/** 打开方式探测结果(Rust open_with.rs 契约)。 */
export interface OpenWithProbe {
  ok: boolean;
}

/** 本地插件文件戳(plugins.rs 契约):文件名 + 内容 SHA-256 + 大小 + mtime(版本库排序)。 */
export interface LocalPluginFileStamp {
  name: string;
  /** 内容 SHA-256(信任闸判据,抗碰撞;AI 有 shell,md5 会被选择前缀碰撞伪造)。 */
  sha256: string;
  size: number;
  modified_ms: number;
}
/** 本地插件扫描条目:坏目录以 error 条目返回(不静默丢,前端落「加载失败」)。 */
export interface LocalPluginScanEntry {
  id: string;
  manifest?: Record<string, unknown>;
  files: LocalPluginFileStamp[];
  versions: LocalPluginFileStamp[];
  error?: string;
}

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
  GitBlameLine,
  GitFileLogEntry,
  GitLogEntry,
  GitPrDefaults,
  GitPrRequest,
  GitPrStage,
  GitPrWorkflowResult,
  GitPushPreview,
  GitRemoteOpReport,
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
  /** 引擎档案 id(仅 SSH 会话:WSL CLI 会话远端跑某引擎,composer/Ask 据此取
   *  CLI profile;kind 仍为 "ssh")。普通 SSH/本地会话无此字段。 */
  engine?: string;
  /** CLI 磁盘身份(注册表视图:桥 resume spawn 直填 / 前端账本绑定经 session_bind_cli
   *  回写;手机壳 session_list 直读,标题/归档/置顶 key 全按此解析)。 */
  cliSessionId?: string;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  root: string;
  createdAt: number;
  /** 所属工作区分组 id(分组定义在 settings.json;空 = 未分组)。 */
  groupId?: string | null;
  /** 显示名覆盖;空 = 显示目录名。 */
  alias?: string | null;
}

interface WorkspacesFile {
  list: WorkspaceMeta[];
  activeId?: string | null;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** 带修改时间的文件条目 —— fsCollectFiles 返回,供 CLI 磁盘会话扫描。 */
interface FileStamp {
  name: string;
  path: string;
  modifiedAt: number;
}

/** 条件尾读结果(对齐 Rust fs::ChangedTail):size 恒为当前文件字节数,
 *  changed = false 时 text 为空(尺寸未变短路)。 */
export interface ChangedTail {
  changed: boolean;
  size: number;
  text: string;
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
  /** 工作区外首轮无前像(批前像不可知):禁回退,仅可查看 / 应用 */
  noBaseline: boolean;
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

interface CkptSkipEntry {
  path: string;
  reason: string;
}

interface CkptRestoreOutcome {
  restored: string[];
  deleted: string[];
  skipped: CkptSkipEntry[];
  guardId: string | null;
  state: "pending" | "reverted";
}



/* ── proc_communicate 契约(对齐 src-tauri/src/proc_run.rs,serde camelCase)── */

interface ProcRunSpec {
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

/* ── wsl_info 契约(wsl 来源插件私有,经通用通道集中于此;对齐 src-tauri/src/wsl.rs,UTF-16LE 由 Rust 解码)── */

export interface WslDistro {
  name: string;
  version: number;
  /** 运行中(wsl -l -v --running 名单求交;状态列是本地化文案,不读)。 */
  running: boolean;
  /** wslconfig 默认发行版。 */
  default: boolean;
}

export interface WslInfo {
  /** false = 非 Windows 或 wsl.exe 不可用/无发行版。 */
  available: boolean;
  wslVersion: string | null;
  distros: WslDistro[];
  /** 默认发行版 $HOME(发行版全停时 null)。 */
  linuxHome: string | null;
  /** 默认发行版登录用户。 */
  linuxUser: string | null;
}

/** WSL 目录条目(wsl_list_dir)。 */
export interface WslDirEntry {
  name: string;
  isDir: boolean;
}

/** WSL 内引擎探针行(wsl_probe_engines;path=null = 未检出)。 */
export interface WslEngineProbe {
  bin: string;
  path: string | null;
}

/** WSL 内文件文本(wsl_read_file_text;content=null = 超过 maxBytes 未读,truncated=true)。 */
interface WslRemoteFileText {
  size: number;
  content: string | null;
  truncated: boolean;
}

/** 未决 SSH 提示对账行(ssh_prompts_pending)。 */
interface SshPendingPromptWire {
  sessionId: string;
  prompt: SshPromptEvent;
}

/** 全文搜索命中(fs_search):path 为 root 相对 posix 路径,line 1 基,text 已去行尾换行。 */
export interface FsSearchHit {
  path: string;
  line: number;
  text: string;
}

/** 全文搜索交付(fs_search):truncated = 3s 预算耗尽或满额,结果不完整。 */
export interface FsSearchResult {
  hits: FsSearchHit[];
  truncated: boolean;
}

/** configHomeDir 的 once 缓存(拒绝时复位,见 ipc.configHomeDir 注)。 */
let configHomeOnce: Promise<string> | null = null;

export const ipc = {
  sessionSpawn: (profileId: string, spec: SpawnSpec, workspaceId?: string) =>
    invoke<SpawnedSession>("session_spawn", { profileId, spec, workspaceId: workspaceId ?? null }),
  sessionList: () => invoke<SessionMeta[]>("session_list"),
  /** 补写会话的工作区归属(接管转正路径:预热 spawn 时归属未知,打开动作落地时补)。 */
  sessionSetWorkspace: (id: string, workspaceId: string | null) =>
    invoke<void>("session_set_workspace", { id, workspaceId }),
  /** 回写活会话的 CLI 磁盘身份(账本绑定唯一写入口的注册表镜像;手机直读)。 */
  sessionBindCli: (id: string, cliSessionId: string) =>
    invoke<void>("session_bind_cli", { id, cliSessionId }),
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
  /** 身份绑定时刻回写「CLI 会话 → 当前代日志」指针(磁盘先行回放寻址)。 */
  sessionLinkLog: (profileId: string, cwd: string, cliSessionId: string, logId: string) =>
    invoke<void>("session_link_log", { profileId, cwd, cliSessionId, logId }),
  /** 冷开磁盘会话:解指针读上一代日志尾;null = 无指针/日志,调用方回落现状路径。
      返回页的 startOffset/hasMore 是文件相对假偏移,只准消费 text。 */
  sessionDiskTail: (profileId: string, cwd: string, cliSessionId: string, maxBytes: number) =>
    invoke<HistoryPage | null>("session_disk_tail", { profileId, cwd, cliSessionId, maxBytes }),
  fsListDir: (path: string) => invoke<DirEntry[]>("fs_list_dir", { path }),
  /** 项目文件索引(composer @ 补全候选):递归 + gitignore/.ignore/.fdignore,
   *  跳 dotfiles/node_modules,返回 root 相对 posix 路径(排序稳定);cap = 上限。
   *  语义镜像 pi/omp TUI 自己的 @ 发现规则(见 fs_walk.rs)。 */
  fsWalkFiles: (root: string, cap: number) => invoke<string[]>("fs_walk_files", { root, cap }),
  /** 带截断标志的项目索引(⌘P 快开/侧栏文件搜索):truncated = cap 满额或
   *  3s 预算断,UI 提示「结果可能不完整」;扁平 fsWalkFiles 面向小目录扫描。 */
  fsWalkIndex: (root: string, cap: number) =>
    invoke<{ files: string[]; truncated: boolean }>("fs_walk_index", { root, cap }),
  /** 全文搜索(rg 式即时扫描,walk 语义与 fsWalkFiles 同源,见 fs_search.rs):
   *  大小写不敏感=两侧 to_lowercase 归一;>3MB/二进制文件跳过;maxResults 全局上限。
   *  3s 预算耗尽或满额时交付部分结果(truncated 置位,UI 提示)。 */
  fsSearch: (root: string, query: string, caseSensitive: boolean, maxResults: number) =>
    invoke<FsSearchResult>("fs_search", { root, query, caseSensitive, maxResults }),
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
  /** 复制文件(资源入库通道,如壁纸受管副本);新建语义,目标已存在报错,256MB 上限。 */
  fsCopyFile: (src: string, dst: string) => invoke<void>("fs_copy_file", { src, dst }),
  /* ── 打开方式(open-with;契约 kernel/openWith.ts,Rust open_with.rs)── */
  /** 用配置的外部应用/命令打开文件;finder 复用 reveal 定位;目标路径恒为最后参数。 */
  fsOpenWith: (path: string, target: OpenWithTarget) =>
    invoke<void>("fs_open_with", { path, target }),
  /** 探测目标可用性(mac 找 .app / command 走 which);探测失败不抛错,返回 ok=false。 */
  fsProbeOpenApp: (target: OpenWithTarget) =>
    invoke<OpenWithProbe>("fs_probe_open_app", { target }),
  /** 提取应用图标 data URL(mac bundle icns→sips→png);失败返回 null,调用方回落通用图标。 */
  fsOpenAppIcon: (appName: string) => invoke<string | null>("fs_open_app_icon", { appName }),
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
  /** 忽略项前缀(git status --ignored 口径;整体忽略目录折叠带尾斜杠,如 "node_modules/")。
   *  侧栏工作区文件浏览器降显用;非仓报错由调用方兜底空集。 */
  gitIgnoredPrefixes: (cwd: string) => invoke<string[]>("git_ignored_prefixes", { cwd }),

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
  /** full = 「全文查看」整文件上下文(单文件按需,勿默认开)。 */
  gitDiffFilePatch: (cwd: string, path: string, staged: boolean, full: boolean) =>
    invoke<GitFilePatch | null>("git_diff_file_patch", { cwd, path, staged, full }),
  gitStage: (cwd: string, paths: string[]) =>
    invoke<void>("git_stage", { cwd, paths }),
  gitUnstage: (cwd: string, paths: string[]) =>
    invoke<void>("git_unstage", { cwd, paths }),
  /** 还原已跟踪文件到 HEAD;untracked 不动。 */
  gitDiscard: (cwd: string, paths: string[]) =>
    invoke<void>("git_discard", { cwd, paths }),
  /** 删除未跟踪文件(≡ git clean -f -- paths);混入 tracked 路径后端整体拒绝。 */
  gitClean: (cwd: string, paths: string[]) =>
    invoke<void>("git_clean", { cwd, paths }),
  /** 勾选提交:paths 非空先 stage 再 commit,单次 IPC 原子完成。 */
  gitCommit: (cwd: string, paths: string[], input: GitCommitInput) =>
    invoke<string>("git_commit", { cwd, paths, input }),
  gitLog: (cwd: string, limit: number, offset: number) =>
    invoke<GitLogEntry[]>("git_log", { cwd, limit, offset }),
  /** 文件维度提交历史(新→旧;合并提交只比对首父,同 GitHub 口径)。 */
  gitFileLog: (cwd: string, path: string, limit: number) =>
    invoke<GitFileLogEntry[]>("git_file_log", { cwd, path, limit }),
  /** 逐行归属(工作区文件 vs 历史;boundary = 与上一行不同提交)。 */
  gitBlame: (cwd: string, path: string) =>
    invoke<GitBlameLine[]>("git_blame", { cwd, path }),
  /** 单提交文件清单(历史 Graph 展开;sha 口径 = 提交 vs 首父)。 */
  gitCommitFiles: (cwd: string, sha: string) =>
    invoke<GitCommitFile[]>("git_commit_files", { cwd, sha }),
  /** 提交内单文件 patch;path 按 新路径/rename 来源 匹配。 */
  gitCommitFilePatch: (cwd: string, sha: string, path: string, full: boolean) =>
    invoke<GitFilePatch | null>("git_commit_file_patch", { cwd, sha, path, full }),
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
  /** pull/push/fetch 统一入口;branch 缺省作用于当前分支(fetch 缺省 = --all --prune)。
   *  pull 非当前分支 = 仅 fast-forward 上游引用;fetch 带分支 = 刷新该分支上游引用。
   *  返回完成明细(快速路径成功文案/up_to_date 依据,同 gitRemoteRequest)。 */
  gitPullPush: (cwd: string, op: "pull" | "push" | "fetch", branch?: string) =>
    invoke<GitRemoteOpReport>("git_pull_push", { cwd, op, branch: branch ?? null }),
  /** 已配置远端名列表(推送/拉取对话框远端下拉)。 */
  gitRemotes: (cwd: string) => invoke<string[]>("git_remotes", { cwd }),
  /** 推送预览:HEAD 相对 <remote>/<branch> 的独有提交;低频,仅在对话框内按需拉。 */
  gitPushPreview: (cwd: string, remote: string, branch: string, limit?: number) =>
    invoke<GitPushPreview>("git_push_preview", { cwd, remote, branch, limit: limit ?? null }),
  /** 远端对话框结构化请求(带选项);pull 移动 HEAD;返回完成明细(通知文案数据源)。 */
  gitRemoteRequest: (cwd: string, req: GitRemoteRequest) =>
    invoke<GitRemoteOpReport>("git_remote_request", { cwd, req }),
  /** 创建 PR defaults(upstream/origin 解析 + 模板兜底;不可创建时带人话原因)。 */
  gitPrDefaults: (cwd: string) => invoke<GitPrDefaults>("git_pr_defaults", { cwd }),
  /** 创建 PR 四步工作流(precheck→push→createPr→comment);阶段经 git://pr-stage 实时推送。 */
  gitPrRun: (cwd: string, req: GitPrRequest) =>
    invoke<GitPrWorkflowResult>("git_pr_run", { cwd, req }),
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
  /** 尾读 + 尺寸闸(语义见 Rust fs::read_tail_changed):lastSize 未变短路免读,
   *  变化拍一次 IPC 完成探测与读取。会话状态巡航 2s 一拍的主力入口。 */
  fsReadTailChanged: (path: string, maxBytes: number, lastSize: number | null) =>
    invoke<ChangedTail>("fs_read_tail_changed", { path, maxBytes, lastSize }),
  /** 读文件头部 maxBytes 字节(解析 jsonl 首行 meta 用,避免全文加载)。 */
  fsReadHead: (path: string, maxBytes: number) =>
    invoke<string>("fs_read_head", { path, maxBytes }),
  /** 物理删除文件或目录(会话列表"删除会话"用);kimi 会话是目录,统一走此命令。
   *  路径不存在视为成功(幂等)。 */
  fsRemovePath: (path: string) => invoke<void>("fs_remove_path", { path }),
  configHomeDir: () => {
    /* 主目录每进程恒定:扫描/配额/GUI 共 47 处每动作重复取,once 缓存全量受益;
       拒绝不缓存(复位重试),失败语义与直连一致。 */
    configHomeOnce ??= invoke<string>("config_home_dir").catch((e) => {
      configHomeOnce = null;
      throw e;
    });
    return configHomeOnce;
  },
  /** 应用配置目录(~/.tmd-cli),布局 owner 是 Rust session.rs;插件勿自拼。 */
  configDir: () => invoke<string>("config_dir"),
  /** 默认工作区根目录(~/.tmd-cli/default,Rust 侧已确保存在,mac/win 兼容)。 */
  configDefaultWorkspaceRoot: () =>
    invoke<string>("config_default_workspace_root"),
  configReadWorkspaces: () => invoke<WorkspacesFile>("config_read_workspaces"),
  configWriteWorkspaces: (data: WorkspacesFile) =>
    invoke<void>("config_write_workspaces", { data }),
  /** 读全局设置(~/.tmd-cli/settings.json);文件不存在/损坏返回 null,前端 sanitize 兜底。 */
  configReadSettings: () => invoke<unknown>("config_read_settings"),
  /** 补丁写全局设置:只携带被改顶层域,Rust 锁内合并落盘;schema 归 kernel/settings.ts。 */
  configMergeSettings: (patch: unknown) =>
    invoke<void>("config_merge_settings", { patch }),
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
  /** 本机 WSL 诊断:发行版表/版本/运行态(wsl 插件消费;契约对齐 src-tauri/src/wsl.rs)。 */
  wslInfo: () => invoke<WslInfo>("wsl_info"),
  /** 远程 WSL 探测:经 SSH 连 Windows 宿主跑 wsl.exe 诊断(平台无关;mac 客户端可直连)。 */
  wslRemoteInfo: (host: SshHostConfig) => invoke<WslInfo>("wsl_remote_info", { host }),
  /** WSL 目录懒加载:host 缺省 = 本机 wsl.exe(仅 Windows),否则经 SSH 远程执行。 */
  wslListDir: (distro: string, path: string, host?: SshHostConfig) =>
    invoke<WslDirEntry[]>("wsl_list_dir", { distro, path, host: host ?? null }),
  /** WSL 内引擎探针(bins 来自 cli profile 清单,内核零引擎知识)。 */
  wslProbeEngines: (distro: string, bins: string[], host?: SshHostConfig) =>
    invoke<WslEngineProbe[]>("wsl_probe_engines", { distro, bins, host: host ?? null }),
  /** WSL 内脚本执行(来源 remoteExec 协议的传输层;非零退出返回空串不报错)。 */
  wslExec: (distro: string, script: string, host?: SshHostConfig) =>
    invoke<string>("wsl_exec", { distro, script, host: host ?? null }),
  /** WSL 内文件文本读取(远程工作区文件树 → 本地渲染管线;host 缺省 = 本机,仅 Windows)。 */
  wslReadFileText: (distro: string, path: string, maxBytes: number, host?: SshHostConfig) =>
    invoke<WslRemoteFileText>("wsl_read_file_text", {
      distro,
      path,
      maxBytes,
      host: host ?? null,
    }),
  /** 未决 SSH 提示对账(接线竞态/webview reload 兜底,先例 refreshForwards)。 */
  sshPromptsPending: () => invoke<SshPendingPromptWire[]>("ssh_prompts_pending"),
  /** 字符串 MD5(小写 hex;通用原语,消费方的用途注记归各插件)。 */
  md5Hex: (text: string) => invoke<string>("md5_hex", { text }),

  /* ── 本地插件原语(plugins.rs;路径白名单在 Rust 侧锁死 ~/.tmd-cli/plugins)── */
  /** 扫描插件目录:manifest 原始 JSON + 顶层文件戳(SHA-256)+ .versions 版本库清单。 */
  pluginScan: () => invoke<LocalPluginScanEntry[]>("plugin_scan"),
  /** 读插件目录顶层单文件(entry/style;16MB 上限)。读+哈希原子出证:前端核对此哈希
   *  与扫描戳一致才 import(信任闸闭环,消除「扫描后文件被换」双读断裂)。 */
  pluginReadFile: (id: string, name: string) =>
    invoke<{ content: string; sha256: string }>("plugin_read_file", { id, name }),
  /** 当前入口归档进版本库(同内容按 hash 去重);返回归档文件名或 null。 */
  pluginArchive: (id: string) => invoke<string | null>("plugin_archive", { id }),
  /** 回退:先归档当前版,再把指定版本换回入口。 */
  pluginRollback: (id: string, file: string) =>
    invoke<void>("plugin_rollback", { id, file }),
  /** 卸载本地插件:目录整体移入系统废纸篓(路径 Rust 侧锁死,前端只传 id)。 */
  pluginDelete: (id: string) => invoke<void>("plugin_delete", { id }),
  /** 创建 SSH 会话:立即返回 id,连接/认证后台完成(ssh://event / ssh://prompt)。
   *  command 可选 = PTY 内初始命令(远程 WSL 会话:wsl.exe 包装串;缺省 = 交互 shell)。 */
  sshSessionCreate: (
    host: SshHostConfig,
    cwd: string,
    workspaceId?: string,
    cols?: number,
    rows?: number,
    command?: string,
    engineProfile?: string,
  ) =>
    invoke<SpawnedSession>("ssh_session_create", {
      host,
      cwd,
      workspaceId: workspaceId ?? null,
      cols: cols ?? null,
      rows: rows ?? null,
      command: command ?? null,
      engineProfile: engineProfile ?? null,
    }),
  /** 重连 SSH 会话:后端取原主机配置(凭据不出后端)收尾旧会话后同配置新建,新会话新 id。 */
  sshSessionReconnect: (sessionId: string, cwd: string, workspaceId?: string) =>
    invoke<SpawnedSession>("ssh_session_reconnect", {
      sessionId,
      cwd,
      workspaceId: workspaceId ?? null,
    }),
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

/* 纯桌面 API 静态 import:R3 白名单文件,web 态经 isWeb 提前分流不触达。 */
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** 窗口最小化(自绘 titlebar 用;macOS 系统红绿灯下不会被调用)。web 态 = 浏览器标签页,无窗口可控 → no-op。 */
export function windowMinimize(): Promise<void> {
  return isWeb ? Promise.resolve() : getCurrentWindow().minimize();
}

/** 窗口最大化/还原切换。web 态 no-op。 */
export function windowToggleMaximize(): Promise<void> {
  return isWeb ? Promise.resolve() : getCurrentWindow().toggleMaximize();
}

/** 界面缩放:webview 整页 zoom(mac pageZoom / win zoomFactor / gtk zoom_level)。
 *  需 capability core:webview:allow-set-webview-zoom;web 态 reject 由 kernel/uiZoom 兜底。 */
export function setWebviewZoom(factor: number): Promise<void> {
  return isWeb ? Promise.reject(new Error("no webview")) : getCurrentWebview().setZoom(factor);
}

/** 关闭窗口。web 态 = 关闭当前标签页(脚本打开的页面有效,否则浏览器静默忽略)。 */
export function windowClose(): Promise<void> {
  if (isWeb) {
    window.close();
    return Promise.resolve();
  }
  return getCurrentWindow().close();
}

/** 应用版本号(关于/设置页脚展示)。web 态走桥 hello 帧上报的版本(serverVersion)。 */
export async function appVersion(): Promise<string> {
  if (isWeb) return (await serverVersion()) ?? "";
  return getVersion();
}

/* ── 应用内自动更新(tauri-plugin-updater / process 薄包装)────────
 * 通道 = GitHub Releases latest.json(minisign 签名产物,endpoint 与
 * pubkey 在 tauri.conf.json plugins.updater)。能力检测:浏览器 dev 无
 * Tauri runtime,调用方以 hasNativeUpdater 分流。 */

export type { Update, DownloadEvent };

/** 浏览器 dev(无 Tauri runtime)恒 false;应用内恒 true。 */
export function hasNativeUpdater(): boolean {
  return !isWeb;
}

/** 查询更新通道:有可用更新返回句柄(此后 downloadAndInstall),无更新返回 null。 */
export function updaterCheck(): Promise<Update | null> {
  return isWeb ? Promise.resolve(null) : check();
}

/** 安装已下载的更新并重启应用(updater 下载落临时目录,install 交换后 relaunch 生效)。 */
export function relaunchApp(): Promise<void> {
  return isWeb ? Promise.resolve() : relaunch();
}

/** 重启应用(插件市场"拔插 = 重启生效"的一键入口;浏览器 dev 无 Tauri runtime,调用方需兜底)。 */
export function appRestart(): Promise<void> {
  return invoke<void>("app_restart");
}

/* ── 系统通知(tauri-plugin-notification 薄包装)────────
 * notify 插件的桌面级提醒通道(Ask 等待/轮次结束/会话退出/额度预警)。
 * web 态(手机浏览器)无 OS 通知 → 恒 false,手机侧走自己的审批卡与轮询面;
 * macOS 首次发送经系统权限弹窗,拒绝后恒 false 由调用方自行吞掉。 */

/** 发一条系统通知;未授权时静默请求一次授权。返回是否真正发出(web 态/拒绝/异常 = false)。 */
export async function sendOsNotification(title: string, body: string): Promise<boolean> {
  if (isWeb) return false;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return false;
    await sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

/** 目录选择对话框;返回绝对路径,取消返回 null。web 态无文件系统对话框 → null。 */
export function pickDirectory(title: string): Promise<string | null> {
  return isWeb ? Promise.resolve(null) : openDialog({ directory: true, multiple: false, title });
}

/** 应用选择对话框(打开方式「浏览…」):选 .app/可执行文件,取消返回 null。web 态 → null。 */
export function pickOpenWithApp(): Promise<string | null> {
  return isWeb ? Promise.resolve(null) : openDialog({ multiple: false, title: "选择应用" });
}

/** 文件选择对话框(上传等需要本地文件路径的场景);取消返回 null。web 态 → null。 */
export function pickFile(title: string): Promise<string | null> {
  return isWeb ? Promise.resolve(null) : openDialog({ directory: false, multiple: false, title });
}

/** 保存路径选择对话框(导出/另存为);返回绝对路径,取消返回 null。web 态 → null。 */
export function pickSavePath(title: string, defaultPath?: string): Promise<string | null> {
  return isWeb ? Promise.resolve(null) : saveDialog({ title, defaultPath });
}

/** 多选本地图片对话框(壁纸库导入);取消返回空数组。web 态 → []。 */
export async function pickImageFiles(title: string): Promise<string[]> {
  const selection = isWeb
    ? null
    : await openDialog({
        directory: false,
        multiple: true,
        title,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
        ],
      });
  if (Array.isArray(selection)) return selection;
  return typeof selection === "string" ? [selection] : [];
}

/** 系统默认浏览器打开外链;web 态直接 window.open(同源新标签)。 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isWeb) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await shellOpen(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** 本地文件路径 → URL(markdown/壁纸图)。webview = asset://;web 态 = 桥 /file 只读下载。 */
export function assetUrl(path: string): string {
  return isWeb
    ? `/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(webToken ?? "")}`
    : convertFileSrc(path);
}

/** Web 访问桥状态(对齐 src-tauri/src/web/web_access.rs WebAccessInfoWire)。 */
export interface WebAccessInfo {
  url: string;
  port: number;
  token: string;
  lanIp: string;
}

/** 查询桥状态;未运行返回 null。 */
export function webAccessStatus(): Promise<WebAccessInfo | null> {
  return invoke<WebAccessInfo | null>("web_access_status");
}

/** 订阅桥存活浏览器连接数(0↔N 边沿即发;桌面徽标消费)。 */
export function onWebRemoteControl(cb: (count: number) => void) {
  return listen<{ count: number }>("web://remote-control", (ev) => cb(ev.payload.count));
}

/** 存活 WS 客户端数(桌面徽标消费;>0 即「远程控制中」)。 */
export function remoteControlActive(): Promise<number> {
  return invoke<number>("remote_control_active");
}

/** 中继连接状态;未连接返回 null。 */
export interface RelayInfo {
  url: string;
  agentUrl: string;
  connected: boolean;
  error: string | null;
}

/** 启动中继(传入 base URL + key;同时把 LAN 桥带起)。 */
export function webRelayStart(url: string, key: string): Promise<RelayInfo> {
  return invoke<RelayInfo>("web_relay_start", { url, key });
}

/** 停止中继(LAN 桥不随之停)。 */
export function webRelayStop(): Promise<void> {
  return invoke<void>("web_relay_stop");
}

/** 查询中继状态;未运行返回 null。 */
export function webRelayStatus(): Promise<RelayInfo | null> {
  return invoke<RelayInfo | null>("web_relay_status");
}

/** 订阅中继状态变化(连接/断开/错误)。 */
export function onWebRelay(cb: (info: RelayInfo | null) => void) {
  return listen<RelayInfo | null>("web://relay", () => {
    /* 事件 payload 为 Null,真正状态以 webRelayStatus 为准 —— 事件仅作「刷新信号」。 */
    void webRelayStatus().then(cb).catch(() => cb(null)); /* 桥不通时回 null 状态,不裸抛 unhandledrejection */
  });
}

/** 一键部署中继到用户自有 Cloudflare(Worker + Durable Object);token 仅本次调用内使用。 */
export function relayDeploy(token: string, accountId?: string): Promise<{ url: string; key: string }> {
  return invoke<{ url: string; key: string }>("relay_deploy", { token, accountId });
}

/** 导出中继部署包(zip;自行 wrangler deploy)。key 缺省时后端铸随机 key 烧入。 */
export function relayDeployPack(path: string, key?: string): Promise<string> {
  return invoke<string>("relay_deploy_pack", { path, key });
}

/** 自建服务器一键部署请求(Rust relay_deploy_selfhost 契约;凭据仅本次调用内使用)。 */
export interface SelfhostDeployReq {
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  /** 未知主机指纹时,用户点「信任并重试」置 true(TOFU)。 */
  trustHostKey?: boolean;
}

/** 自建部署结果;steps 固定序列 connect/cert/upload/systemd/health。 */
export interface SelfhostDeployResult {
  ok: boolean;
  url: string;
  key: string;
  fingerprint: string;
  steps: { id: string; ok: boolean; error?: string }[];
  /** 仅当主机指纹未知:steps 里 connect 步 ok=false。 */
  hostKeyFingerprint?: string;
}

/** 部署进度事件(web-relay-deploy payload;step 完成时发,ok=false 即失败)。 */
export interface RelayDeployProgress {
  step: string;
  ok: boolean;
  error?: string;
}

/** 一键 SSH 部署自建中继(成功时 Rust 自己落 settings url/key/certDer/certHost)。 */
export function relayDeploySelfhost(req: SelfhostDeployReq): Promise<SelfhostDeployResult> {
  return invoke<SelfhostDeployResult>("relay_deploy_selfhost", { req });
}

/** 导出自建中继部署包(zip;mjs+证书+env+unit+README,铸该 host 自签证书并落 settings)。 */
export function relaySelfhostPack(path: string, host: string): Promise<string> {
  return invoke<string>("relay_selfhost_pack", { path, host });
}

/** 订阅自建部署进度事件;返回退订函数。 */
export function onRelayDeployProgress(cb: (e: RelayDeployProgress) => void): Promise<() => void> {
  return listen<RelayDeployProgress>("web-relay-deploy", (ev) => cb(ev.payload));
}

// ==================== 设备配对(桌面设置卡) ====================

/** 配对 offer:桥须在运行;url = tmd://pair?c=… 短链(内嵌 LAN/relay 与配对码)。 */
export interface PairOffer {
  url: string;
  pairCode: string;
  /** 过期 unix 秒。 */
  expiresAt: number;
}

/** 铸一次性配对 offer(10min TTL,单次消费)。 */
export function webPairOffer(): Promise<PairOffer> {
  return invoke<PairOffer>("web_pair_offer");
}

/** 已配对设备行(脱敏:token hash 不出桌面)。 */
export interface DeviceWire {
  deviceId: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  approved: boolean;
  /** 当前是否有活连接(设备卡「已连接/离线」点)。 */
  online?: boolean;
  /** 配对请求来源 IP(展示;老行可能为空)。 */
  ip?: string;
}

/** 设备表全量(pending + approved 由 approved 字段区分)。 */
export function webDevicesList(): Promise<{ devices: DeviceWire[]; now: number }> {
  return invoke<{ devices: DeviceWire[]; now: number }>("web_devices_list");
}

/** 批准 pending 设备;返回是否真的存在该设备。 */
export function webDeviceApprove(deviceId: string): Promise<boolean> {
  return invoke<boolean>("web_device_approve", { deviceId });
}

/** 撤销设备(删行 + 即时踢既有连接);返回是否真的删了。 */
export function webDeviceRevoke(deviceId: string): Promise<boolean> {
  return invoke<boolean>("web_device_revoke", { deviceId });
}

/** 订阅设备表变更(批准/撤销后发;UI 以 webDevicesList 重取为准)。 */
export function onWebDevices(cb: () => void) {
  return listen<unknown>("web://devices", () => cb());
}

/** 手机已消费配对码(POST /pair 200):配对卡收起码区,显示 pending 行。 */
export function onWebPairConsumed(cb: () => void) {
  return listen<unknown>("web://pair-consumed", () => cb());
}

/** 配对码节流告警(同 IP 连续错码 5 次):设置卡 toast。 */
export function onWebPairAlert(cb: (ip: string, limit: number) => void) {
  return listen<{ ip: string; limit: number }>("web://pair-alert", (ev) =>
    cb(ev.payload.ip, ev.payload.limit),
  );
}

interface QuotaFetchSpec {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** true = 响应按原始文本返回(body 为字符串),跳过 JSON 解析(如 atom/xml 源)。 */
  text?: boolean;
  /** true = 不跟随重定向(3xx 原样返回),供鉴权 cookie 交换等场景。 */
  noRedirect?: boolean;
  /** true = 响应携带 headers(多值 map,set-cookie 等多值头不丢)。 */
  includeHeaders?: boolean;
}

interface QuotaFetchResponse {
  status: number;
  body: unknown;
  /** 请求声明 includeHeaders 时才存在;键为小写头名。 */
  headers?: Record<string, string[]>;
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
  /** 命中副本位于 npm 全局布局内时的所属 prefix;非 npm 副本 = null。 */
  npmPrefix: string | null;
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

/** 桥(web/手机)发起会话的装配请求事件(Rust dispatch_session 广播)。 */
export interface ExternalSpawnEvent {
  sessionId: string;
  profileId: string;
  cliSessionId?: string;
}

/** 订阅桥发起会话事件:桌面走 adoptPtySession 补全装配(见 app-shell/DesktopApp)。 */
export function onExternalSpawn(cb: (e: ExternalSpawnEvent) => void) {
  return listen<ExternalSpawnEvent>("session:external-spawn", (ev) => cb(ev.payload));
}

/** 订阅桥(手机/浏览器)写入事件:桌面补锚定(桥 session_write 成功广播)。 */
export function onRemoteWrite(cb: (sessionId: string) => void) {
  return listen<{ sessionId: string }>("session:remote-write", (ev) =>
    cb(ev.payload.sessionId),
  );
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

/** 订阅创建 PR 工作流的阶段进度(全局通道;四卡实时点亮)。 */
export function onGitPrStage(cb: (stages: GitPrStage[]) => void) {
  return listen<GitPrStage[]>("git://pr-stage", (ev) => cb(ev.payload));
}

/* ---------- LSP 通用原语(长驻 stdio 语言服务器;方法语义全在前端 kernel/lsp) ---------- */

/** 启动(或幂等复用)某 key 的语言服务器进程。 */
export function lspSpawn(
  key: string,
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Record<string, string>,
) {
  return invoke<void>("lsp_spawn", { key, command, args, cwd, env });
}

/** 写入一条完整 JSON-RPC 消息(前端已组好串;Rust 只组帧)。 */
export function lspSend(key: string, message: string) {
  return invoke<void>("lsp_send", { key, message });
}

/** 杀树收割某 key 的语言服务器。 */
export function lspStop(key: string) {
  return invoke<void>("lsp_stop", { key });
}

/** LSP 事件结构(Rust lsp.rs 双扇出)。 */
export interface LspMessageEvent {
  key: string;
  payload: string;
}
export interface LspExitEvent {
  key: string;
  code: number | null;
}

/** 订阅 LSP 完整 JSON 消息(全局通道,按 key 归属)。 */
export function onLspMessage(cb: (e: LspMessageEvent) => void) {
  return listen<LspMessageEvent>("lsp://message", (ev) => cb(ev.payload));
}

/** 订阅 LSP 进程退出。 */
export function onLspExit(cb: (e: LspExitEvent) => void) {
  return listen<LspExitEvent>("lsp://exit", (ev) => cb(ev.payload));
}
