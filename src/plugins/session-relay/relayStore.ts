/**
 * 接力源状态 + pending 接力载荷 ── 模块级单例(命令处理器在 React 外置源;
 * 浮层/芯片订阅渲染)。pending 载荷 keyed by 目标会话 id:RelayDialog 挂入,
 * composer 芯片展示,发送变换消费(relayCarry)。
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

/* ── pending 接力载荷(芯片数据面)── */

/** 挂到目标会话 composer 的接力摘要(芯片展示 + 发送时前置拼装)。 */
export interface PendingRelayPayload {
  text: string;
  truncated: boolean;
  source: RelaySource;
}

/* ponytail: 上限 8 条 —— 并发接力会话少见,Map 插入序 LRU 够用,溢出即最老丢弃。 */
const MAX_PENDING_RELAY = 8;
const pendingRelay = new Map<string, PendingRelayPayload>();

export function subscribePendingRelay(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingRelay(sessionId: string): PendingRelayPayload | null {
  return pendingRelay.get(sessionId) ?? null;
}

export function setPendingRelay(sessionId: string, payload: PendingRelayPayload): void {
  pendingRelay.delete(sessionId);
  pendingRelay.set(sessionId, payload);
  while (pendingRelay.size > MAX_PENDING_RELAY) {
    const oldest = pendingRelay.keys().next().value;
    if (oldest === undefined) break;
    pendingRelay.delete(oldest);
  }
  emit();
}

export function dropPendingRelay(sessionId: string): void {
  if (!pendingRelay.delete(sessionId)) return;
  emit();
}

export function usePendingRelay(sessionId: string | null): PendingRelayPayload | null {
  return useSyncExternalStore(
    subscribePendingRelay,
    () => (sessionId ? getPendingRelay(sessionId) : null),
  );
}
