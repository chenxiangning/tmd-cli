/**
 * 增强对话框开关 store —— 模块级订阅态(search/overlayStore 先例):
 * inputRail 图标与全局快捷键(Cmd+Alt+E)同走 openEnhance();草稿为空不响应。
 * 对话框本体由 EnhanceButton 挂载渲染(命令路径共享同一渲染点)。
 */

import { useSyncExternalStore } from "react";
import { composerDraftRef } from "@kernel/composerExt";

let open = false;
const subs = new Set<() => void>();

export function useEnhanceOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => open,
  );
}

export function closeEnhance(): void {
  if (!open) return;
  open = false;
  for (const cb of subs) cb();
}

/** 打开对话框;草稿非空才生效(与图标点击同语义)。返回是否已打开。 */
export function openEnhance(): boolean {
  if (open || !(composerDraftRef.current?.() ?? "").trim()) return false;
  open = true;
  for (const cb of subs) cb();
  return true;
}
