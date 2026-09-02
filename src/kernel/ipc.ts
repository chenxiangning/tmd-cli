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

export interface GitStatus {
  branch: string;
  porcelain: string;
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
  /** 本地图片 → data URL(markdown 预览 asset:// 失败回退;Rust 侧白名单+大小闸)。 */
  readLocalImageDataUrl: (path: string) =>
    invoke<string>("read_local_image_data_url", { path }),
  gitStatus: (cwd: string) => invoke<GitStatus>("git_status", { cwd }),
  /** 递归收集目录下指定后缀文件,按修改时间倒序。目录不存在 = 空表。 */
  fsCollectFiles: (dir: string, suffix: string) =>
    invoke<FileStamp[]>("fs_collect_files", { dir, suffix }),
  /** 读取文件尾部 maxBytes 字节,供 session 状态增量解析。 */
  fsReadTail: (path: string, maxBytes: number) =>
    invoke<string>("fs_read_tail", { path, maxBytes }),
  /** 读文件头部 maxBytes 字节(解析 jsonl 首行 meta 用,避免全文加载)。 */
  fsReadHead: (path: string, maxBytes: number) =>
    invoke<string>("fs_read_head", { path, maxBytes }),
  /** 物理删除文件(会话列表"删除会话"用);文件不存在视为成功(幂等)。 */
  fsRemoveFile: (path: string) => invoke<void>("fs_remove_file", { path }),
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
