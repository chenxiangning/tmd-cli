/**
 * 命令抽屉开合 store —— 模块级单例(同 attachments/filePanel 惯例)。
 *
 * 两端共享:ComposerToolbar(开关按钮在 statusbar Mount 树)与 Composer(挂载抽屉),
 * 两者无 props 通道,经此 store 同步;⌘K / Esc / 点外关闭都写这里。
 */

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function isDrawerOpen(): boolean {
  return open;
}

export function setDrawerOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function toggleDrawer(): void {
  setDrawerOpen(!open);
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isDrawerOpen,
  );
}
