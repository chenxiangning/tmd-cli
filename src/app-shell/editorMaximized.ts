/**
 * 编辑区最大化全局开关 —— FileTab 按钮与 AppShell 布局双端消费,
 * 必须是共享 store(usePersistedToggle 的组件内 useState 会两端分叉)。
 * 写法对齐 kernel/tabs.ts;localStorage 持久化(key shell.editorMax)。
 *
 * 语义:最大化且存在 tab 时,横向 group 隐藏左 session 栏与中央幕布,
 * 编辑区 + 右文件面板(不参与)并占通栏;无 tab 时标志不生效。
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
