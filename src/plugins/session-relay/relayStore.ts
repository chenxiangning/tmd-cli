/**
 * 接力源状态 ── 模块级单例(命令处理器在 React 外置源;浮层订阅渲染)。
 */
import { useSyncExternalStore } from "react";
import type { RelaySource } from "./relay";

let source: RelaySource | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** 置源并开浮层(重复置源 = 覆盖上一次,幂等)。 */
export function setRelaySource(next: RelaySource): void {
  source = next;
  emit();
}

export function clearRelaySource(): void {
  source = null;
  emit();
}

export function useRelaySource(): RelaySource | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => source,
  );
}
