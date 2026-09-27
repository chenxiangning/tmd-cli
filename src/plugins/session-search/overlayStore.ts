/**
 * 会话检索浮层状态 ── 模块级单例 store(命令处理器在 React 外开浮层)。
 * 形态复刻 search 插件的 overlayStore(居中 portal + Esc/遮罩关)。
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function openSessionSearch(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeSessionSearch(): void {
  if (!open) return;
  open = false;
  emit();
}

export function useSessionSearchOpen(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => open,
  );
}
