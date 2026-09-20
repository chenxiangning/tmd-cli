/**
 * 工作区文件浏览器桥 —— 左栏工作区行「查看文件」入口 → 侧栏整体切换为该
 * 工作区的文件浏览器。发起方(workspace 插件,行按钮)与实现方(files 插件,
 * 浏览器视图)不可互 import,契约落 kernel(先例:sessionReveal / fileTabs)。
 *
 * - 开合态:模块级单例 + useSyncExternalStore;openId 为 null 即任务列表常态
 * - 视图实现:files 插件 activate 时注册;未注册时 openWorkspaceFiles 是
 *   no-op,入口按钮以「实现已注册」为可见前提
 * - 关闭语义归视图自身(「返回工作区」按钮直调 closeWorkspaceFiles),
 *   workspace 插件只负责按 openId 换渲染
 */

import { useSyncExternalStore, type ComponentType } from "react";

/** 浏览器视图组件面:workspaceId 定位目标工作区,root 为其磁盘根路径。 */
export interface WorkspaceFileBrowserProps {
  workspaceId: string;
  root: string;
}

let view: ComponentType<WorkspaceFileBrowserProps> | null = null;
let openId: string | null = null;
const listeners = new Set<() => void>();

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** files 插件注册/摘除视图实现;摘除(传 null)时顺手关闭已开视图。 */
export function registerWorkspaceFileBrowser(
  comp: ComponentType<WorkspaceFileBrowserProps> | null,
): void {
  view = comp;
  if (!comp) openId = null;
  emit();
}

/** 行入口点击:打开该工作区的浏览器(同刻至多一个;实现未注册 = no-op)。 */
export function openWorkspaceFiles(workspaceId: string): void {
  if (!view) return;
  openId = workspaceId;
  emit();
}

/** 「返回工作区」:关闭浏览器回任务列表;本就关闭时 no-op。 */
export function closeWorkspaceFiles(): void {
  if (openId === null) return;
  openId = null;
  emit();
}

/** 当前打开浏览器的工作区 id(null = 任务列表);侧栏据此整体换渲染。 */
export function getWorkspaceFileBrowserOpenId(): string | null {
  return openId;
}

/** 视图实现组件(files 插件注册;null = 未启用,入口按钮应隐藏)。 */
export function getWorkspaceFileBrowserView(): ComponentType<WorkspaceFileBrowserProps> | null {
  return view;
}

export function useWorkspaceFileBrowserOpenId(): string | null {
  return useSyncExternalStore(subscribe, getWorkspaceFileBrowserOpenId);
}

export function useWorkspaceFileBrowserView(): ComponentType<WorkspaceFileBrowserProps> | null {
  return useSyncExternalStore(subscribe, getWorkspaceFileBrowserView);
}
