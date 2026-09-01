/**
 * IPC 薄封装 —— 前端触达 Rust 后端的唯一入口。
 * 模式复用 mossx 的 services/tauri 分层，但砍到只剩直连。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

export interface SessionMeta {
  id: string;
  profileId: string;
  cwd: string;
  pid?: number;
  cliSessionId?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface GitStatus {
  branch: string;
  porcelain: string;
}

export const ipc = {
  sessionSpawn: (profileId: string, spec: SpawnSpec) =>
    invoke<SpawnedSession>("session_spawn", { profileId, spec }),
  sessionList: () => invoke<SessionMeta[]>("session_list"),
  sessionWrite: (id: string, data: string) =>
    invoke<void>("session_write", { id, data }),
  sessionResize: (id: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { id, cols, rows }),
  sessionKill: (id: string) => invoke<void>("session_kill", { id }),
  fsListDir: (path: string) => invoke<DirEntry[]>("fs_list_dir", { path }),
  fsWriteTemp: (name: string, data: Uint8Array) =>
    invoke<string>("fs_write_temp", { name, data: Array.from(data) }),
  fsReadFile: (path: string) => invoke<string>("fs_read_file", { path }),
  gitStatus: (cwd: string) => invoke<GitStatus>("git_status", { cwd }),
};

/** 订阅某会话的 PTY 输出流。返回退订函数。 */
export function onPtyOutput(sessionId: string, cb: (text: string) => void) {
  return listen<string>(`pty://out/${sessionId}`, (e) => cb(e.payload));
}

/** 订阅某会话的进程退出。返回退订函数。 */
export function onPtyExit(sessionId: string, cb: () => void) {
  return listen(`pty://exit/${sessionId}`, () => cb());
}
