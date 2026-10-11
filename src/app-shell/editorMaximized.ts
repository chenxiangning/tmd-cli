/**
 * 编辑区最大化全局开关 —— FileTab 按钮与 AppShell 布局双端消费,
 * 必须是共享 store(usePersistedToggle 的组件内 useState 会两端分叉)。
 * 写法对齐 kernel/tabs.ts;localStorage 持久化(key shell.editorMax)。
 *
 * 语义:最大化且存在 tab 时,仅横向 group 折叠中央幕布;左栏保持可见、
 * 右栏钉住实测宽度(panel-handle.css),编辑区在中间区域撑满;无 tab 时不生效。
 * 遮盖还原(2026-10-11):「激活会话即还原」的全局事件守卫已撤——后台
 * 自动化(workbench 任务自动状态/会话链、会话退出 MRU 回落)同样广播
 * activeSessionChanged,「激活 ≠ 用户要看幕布」,守卫会把最大化持续打掉
 * (用户实测最大化无效)。现只保留显式还原:用户直点路径调
 * restoreEditorMaximized(现消费方 SessionTabBar 会话 tab 点击;幂等安全)。
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shell.editorMax";

let maximized = localStorage.getItem(STORAGE_KEY) === "1";
const listeners = new Set<() => void>();

function setMaximized(value: boolean): void {
  maximized = value;
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  listeners.forEach((fn) => fn());
}

export function toggleEditorMaximized(): void {
  setMaximized(!maximized);
}

/** 最大化态摘除(用户显式「看会话」路径共用);非最大化态幂等 no-op。 */
export function restoreEditorMaximized(): void {
  if (maximized) setMaximized(false);
}

export function useEditorMaximized(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => maximized,
  );
}

