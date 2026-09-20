/**
 * 编辑区最大化全局开关 —— FileTab 按钮与 AppShell 布局双端消费,
 * 必须是共享 store(usePersistedToggle 的组件内 useState 会两端分叉)。
 * 写法对齐 kernel/tabs.ts;localStorage 持久化(key shell.editorMax)。
 *
 * 语义:最大化且存在 tab 时,仅横向 group 折叠中央幕布;左栏保持可见、
 * 右栏钉住实测宽度(panel-handle.css),编辑区在中间区域撑满;无 tab 时不生效。
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shell.editorMax";

let maximized = localStorage.getItem(STORAGE_KEY) === "1";
const listeners = new Set<() => void>();

export function toggleEditorMaximized(): void {
  maximized = !maximized;
  localStorage.setItem(STORAGE_KEY, maximized ? "1" : "0");
  listeners.forEach((fn) => fn());
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
