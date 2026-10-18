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

/* 定位结果轻提示 ── 命中打开瞬间浮层已关,提示必须活得比浮层久;
   与浮层开关同款模块级单例,呈现件由 SessionSearchOverlay 常驻 portal 承载。 */

const TOAST_TTL_MS = 3000;

let toast: string | null = null;
const toastListeners = new Set<() => void>();
let toastTimer: number | null = null;

function emitToast(): void {
  for (const fn of toastListeners) fn();
}

/** 弹出轻提示(TTL 自销;连弹覆盖前弹并重置计时)。 */
export function showSearchToast(text: string): void {
  toast = text;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = null;
    toastTimer = null;
    emitToast();
  }, TOAST_TTL_MS);
  emitToast();
}

/** 订阅轻提示文本(无提示 = null)。 */
export function useSearchToast(): string | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      toastListeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => toast,
  );
}
