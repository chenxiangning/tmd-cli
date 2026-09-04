/**
 * 网络代理浮层开合状态(模块级 store,同 kernel/settings 模式)。
 *
 * 打开方是 app-shell 侧栏按钮(齿轮菜单项 / 底栏钉住按钮),与本插件
 * 无直接引用 —— 经内核事件总线转发(见 index.tsx 的 activate 订阅):
 * shell → host.events.emit(topic, 锚点坐标) → 插件 → openProxyPopover。
 */

import { useSyncExternalStore } from "react";

interface ProxyPopoverState {
  open: boolean;
  /** 锚点坐标(视口系,来自侧栏按钮 rect,浮层渲染时自行夹取)。 */
  x: number;
  y: number;
}

let state: ProxyPopoverState = { open: false, x: 0, y: 0 };
let snapshot: ProxyPopoverState = state;
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

export function openProxyPopover(x: number, y: number): void {
  state = { open: true, x, y };
  emit();
}

export function closeProxyPopover(): void {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export function useProxyPopoverState(): ProxyPopoverState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
