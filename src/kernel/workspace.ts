/**
 * 工作区 —— 客户端顶层容器:1 工作区 = 1 个根目录(cwd) + 1 组会话历史。
 *
 * 持久化: ~/.tmd-cli/workspaces.json + active_workspace.json
 * 默认工作区: 当 ~/.tmd-cli/workspaces.json 为空时,自动加 tmd-cli 项目本身,
 *   保持首次打开可用。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "./ipc";

export interface Workspace {
  /** 全局唯一 id(短随机字符串)。 */
  id: string;
  /** 显示名(目录末段)。 */
  name: string;
  /** 绝对路径(也是 cwd)。 */
  root: string;
  /** 创建时间 ms epoch。 */
  createdAt: number;
}

interface WorkspaceState {
  list: Workspace[];
  activeId: string | null;
}

const state: WorkspaceState = { list: [], activeId: null };
const listeners = new Set<() => void>();
let snapshot: WorkspaceState = state;

function refreshSnapshot(): void {
  snapshot = { list: [...state.list], activeId: state.activeId };
}

function emit(): void {
  refreshSnapshot();
  listeners.forEach((fn) => fn());
}

const DEFAULT_WORKSPACE: Workspace = {
  id: "default",
  name: "tmd-cli",
  root: "/Users/chenxiangning/code/AI/github/tmd-cli",
  createdAt: 0,
};

async function loadFromDisk(): Promise<void> {
  try {
    const data = await ipc.configReadWorkspaces();
    if (data && Array.isArray(data.list)) {
      state.list = data.list;
      state.activeId = data.activeId ?? state.list[0]?.id ?? null;
    } else {
      state.list = [DEFAULT_WORKSPACE];
      state.activeId = DEFAULT_WORKSPACE.id;
      void persist();
    }
  } catch {
    state.list = [DEFAULT_WORKSPACE];
    state.activeId = DEFAULT_WORKSPACE.id;
  }
  emit();
}

async function persist(): Promise<void> {
  try {
    await ipc.configWriteWorkspaces({
      list: state.list,
      activeId: state.activeId,
    });
  } catch (err) {
    console.warn("workspace: 持久化失败", err);
  }
}

let booted = false;
export function ensureWorkspaceBooted(): void {
  if (booted) return;
  booted = true;
  void loadFromDisk();
}

export function addWorkspace(root: string): Workspace {
  const id = `ws-${Date.now().toString(36)}`;
  const name = root.split("/").filter(Boolean).pop() ?? root;
  const ws: Workspace = { id, name, root, createdAt: Date.now() };
  state.list.push(ws);
  void persist();
  emit();
  return ws;
}

export function removeWorkspace(id: string): void {
  state.list = state.list.filter((w) => w.id !== id);
  if (state.activeId === id) {
    state.activeId = state.list[0]?.id ?? null;
  }
  void persist();
  emit();
}

export function setActiveWorkspace(id: string | null): void {
  if (state.activeId === id) return;
  state.activeId = id;
  void persist();
  emit();
}

export function getActiveWorkspace(): Workspace | null {
  return state.list.find((w) => w.id === state.activeId) ?? null;
}

export function useWorkspaces(): WorkspaceState {
  ensureWorkspaceBooted();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
