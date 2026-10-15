/**
 * anim · 会话引用 pending 桶(session-relay relayStore 同构)── 模块级单例,
 * keyed by 目标会话 id:composer 芯片展示,发送变换消费(sessionRefs.ts)。
 */
import { useSyncExternalStore } from "react";

/** 挂到会话 composer 的引用卡片(label 为 i18n 源键,path 为绝对路径)。 */
export interface PendingAnimRef {
  label: string;
  path: string;
}

/* ponytail: 上限 8 条 —— 并发 anim 会话少见,Map 插入序 LRU 够用,溢出即最老丢弃。 */
const MAX_PENDING_REFS = 8;
const pendingRefs = new Map<string, PendingAnimRef[]>();
const listeners = new Set<() => void>();

const EMPTY: PendingAnimRef[] = [];

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribePendingRefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingRefs(sessionId: string): PendingAnimRef[] {
  return pendingRefs.get(sessionId) ?? EMPTY;
}

export function setPendingRefs(sessionId: string, refs: readonly PendingAnimRef[]): void {
  pendingRefs.delete(sessionId);
  pendingRefs.set(sessionId, [...refs]);
  while (pendingRefs.size > MAX_PENDING_REFS) {
    const oldest = pendingRefs.keys().next().value;
    if (oldest === undefined) break;
    pendingRefs.delete(oldest);
  }
  emit();
}

export function dropPendingRef(sessionId: string, path: string): void {
  const list = pendingRefs.get(sessionId);
  if (!list) return;
  const next = list.filter((ref) => ref.path !== path);
  if (next.length === list.length) return;
  if (next.length === 0) pendingRefs.delete(sessionId);
  else pendingRefs.set(sessionId, next);
  emit();
}

export function dropPendingRefs(sessionId: string): void {
  if (!pendingRefs.delete(sessionId)) return;
  emit();
}

export function usePendingRefs(sessionId: string | null): PendingAnimRef[] {
  return useSyncExternalStore(subscribePendingRefs, () =>
    sessionId ? getPendingRefs(sessionId) : EMPTY,
  );
}

/** 挂到会话 composer 的初始提示词卡片(随下一条消息前置发出,空输入 = 仅发卡片)。 */
const MAX_PENDING_PROMPTS = 8;
const pendingPrompts = new Map<string, string>();

export function getPendingPrompt(sessionId: string): string | null {
  return pendingPrompts.get(sessionId) ?? null;
}

export function setPendingPrompt(sessionId: string, text: string): void {
  pendingPrompts.delete(sessionId);
  pendingPrompts.set(sessionId, text);
  while (pendingPrompts.size > MAX_PENDING_PROMPTS) {
    const oldest = pendingPrompts.keys().next().value;
    if (oldest === undefined) break;
    pendingPrompts.delete(oldest);
  }
  emit();
}

export function dropPendingPrompt(sessionId: string): void {
  if (!pendingPrompts.delete(sessionId)) return;
  emit();
}

export function usePendingPrompt(sessionId: string | null): string | null {
  return useSyncExternalStore(subscribePendingRefs, () =>
    sessionId ? getPendingPrompt(sessionId) : null,
  );
}

