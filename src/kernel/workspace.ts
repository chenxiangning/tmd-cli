/**
 * 工作区 —— 客户端顶层容器:1 工作区 = 1 个根目录(cwd) + 各 CLI 会话。
 *
 * 持久化: ~/.tmd-cli/workspaces.json(列表 + activeId)。
 * 默认工作区: workspaces.json 为空时自动建 `~/.tmd-cli/default`
 *   (根路径由 Rust 计算并确保存在,mac/win 兼容),保持首次打开可用。
 * 会话数据源: 各 CLI 插件 listSessions 扫自己的磁盘存储,本模块不持有映射。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "./ipc";
import { deriveWorkspaceName } from "./pathUtils";

export interface Workspace {
  /** 全局唯一 id(短随机字符串)。 */
  id: string;
  /** 显示名(目录末段)。 */
  name: string;
  /** 绝对路径(也是 cwd)。 */
  root: string;
  /** 创建时间 ms epoch。 */
  createdAt: number;
  /** 所属工作区分组 id(分组定义在 settings.json;空 = 未分组)。 */
  groupId?: string | null;
  /** 显示名覆盖(trim 后落库);空/缺省 = 显示目录名。 */
  alias?: string | null;
  /** 来源插件的工作区元数据(历史命名 wsl;结构与解释归 wsl 来源插件,
   *  kernel 只透传存储 —— 持久化 schema 与 Rust WorkspaceMeta.wsl 配对,勿改名)。
   *  hostId null = 本机 wsl.exe(root 为 UNC)。缺省 = 本地目录工作区。 */
  wsl?: { distro: string; hostId: string | null } | null;
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

/** 构造默认工作区:根目录由 Rust 给出(~/.tmd-cli/default,已建目录)。 */
async function defaultWorkspace(): Promise<Workspace> {
  const root = await ipc.configDefaultWorkspaceRoot();
  return { id: "default", name: "default", root, createdAt: Date.now() };
}

async function loadFromDisk(): Promise<void> {
  try {
    const data = await ipc.configReadWorkspaces();
    const fallback = await defaultWorkspace();
    const loaded = data && Array.isArray(data.list) ? data.list : [];
    // 默认工作区保证在列:缺失则补到首位("提供默认工作区"语义,
    // 删除后下次启动会重建 —— 它是兜底容器,不是普通条目)
    state.list = loaded.some((w) => w.root === fallback.root)
      ? loaded
      : [fallback, ...loaded];
    state.activeId = data?.activeId ?? state.list[0].id;
    void persist();
  } catch {
    // 非 Tauri 环境(浏览器 dev):无默认工作区可用,保持空表
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

/** 首载完成的 Promise(先例 settingsReady):启动自动激活等它再扫会话。 */
const readyGate = Promise.withResolvers<void>();
export const workspacesReady: Promise<void> = readyGate.promise;

let booted = false;
export function ensureWorkspaceBooted(): void {
  if (booted) return;
  booted = true;
  void loadFromDisk().finally(() => readyGate.resolve());
}

export function addWorkspace(root: string, wsl?: { distro: string; hostId: string | null }): Workspace {
  const id = `ws-${Date.now().toString(36)}`;
  const name = deriveWorkspaceName(root);
  const ws: Workspace = { id, name, root, createdAt: Date.now(), wsl: wsl ?? null };
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

/** 调整工作区分组归属(null = 未分组);不存在的工作区 id 静默忽略。 */
export function assignWorkspaceGroup(id: string, groupId: string | null): void {
  const target = state.list.find((w) => w.id === id);
  if (!target || (target.groupId ?? null) === groupId) return;
  target.groupId = groupId;
  void persist();
  emit();
}

/** 设置显示别名(trim;空串清除为 null = 回归目录名);不存在的工作区 id 静默忽略。 */
export function setWorkspaceAlias(id: string, raw: string): void {
  const target = state.list.find((w) => w.id === id);
  const alias = raw.trim() || null;
  if (!target || (target.alias ?? null) === alias) return;
  target.alias = alias;
  void persist();
  emit();
}

/** 全部展示位的唯一取名口:别名非空取别名,否则目录名。 */
export function workspaceDisplayName(ws: Workspace): string {
  return ws.alias?.trim() || ws.name;
}

export function getActiveWorkspace(): Workspace | null {
  return state.list.find((w) => w.id === state.activeId) ?? null;
}

/** 工作区全表快照(会话锚点等非 React 消费方)。 */
export function getWorkspaces(): Workspace[] {
  return state.list;
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
