/**
 * 跨插件契约 · 会话 pending 初始提示词队列(anim refStore 提示词半区上移,
 * 2026-10-18 候选4;≥2 插件消费:anim AI 会话 / workspace 会话预设)──
 * 模块级单例,keyed by 目标会话 id:composer 芯片展示,发送变换经
 * consumePendingPrompt 原子读+清(发送失败由消费方 setPendingPrompt 回写)。
 */

import { useSyncExternalStore } from "react";

/* ponytail: 上限 8 条 —— 并发预设/anim 会话少见,Map 插入序 LRU 够用,溢出即最老丢弃。 */
const MAX_PENDING_PROMPTS = 8;
const pendingPrompts = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** 订阅队列变化(useSyncExternalStore 消费);返回退订函数。 */
export function subscribePendingPrompts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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

/** 消费:原子读 + 清(发送变换唯一消费口;get+drop 两步竞态在此收口)。 */
export function consumePendingPrompt(sessionId: string): string | null {
  const text = pendingPrompts.get(sessionId);
  if (text === undefined) return null;
  pendingPrompts.delete(sessionId);
  emit();
  return text;
}

export function dropPendingPrompt(sessionId: string): void {
  if (!pendingPrompts.delete(sessionId)) return;
  emit();
}

export function usePendingPrompt(sessionId: string | null): string | null {
  return useSyncExternalStore(subscribePendingPrompts, () =>
    sessionId ? getPendingPrompt(sessionId) : null,
  );
}
