/**
 * 跨插件契约 · 会话 pending 初始提示词队列(workspace 会话预设写入,
 * 2026-10-18 自 anim 提取消费半区)──模块级单例,keyed by 目标会话 id:
 * composer 芯片展示,发送变换经 consumePendingPrompt 原子读+清(消费面在
 * 本模块收口,kernel 自持,不依赖任何可拔 feature 插件在场;发送失败由
 * undoPendingPromptSend 回写)。anim 等插件只作生产者(setPendingPrompt)。
 */

import { useSyncExternalStore } from "react";
import {
  registerComposerEmptySendProvider,
  registerComposerSendTransform,
  registerComposerSendUndo,
  type ComposerSendTransform,
} from "./composerExt";

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

let lastConsumedPrompt: { sessionId: string; prompt: string } | null = null;

/** 提示词前置注入消费面(kernel 自持,与 anim refs 半区同构拼接)。 */
export const pendingPromptSendTransform: ComposerSendTransform = (text, sessionId) => {
  if (!sessionId) return text;
  const prompt = consumePendingPrompt(sessionId);
  if (prompt === null) return text;
  lastConsumedPrompt = { sessionId, prompt };
  return [prompt, text].filter((part) => part !== "").join("\n\n");
};

/** 发送失败回滚:恢复最后一次消费的提示词(幂等,无消费 no-op)。 */
export function undoPendingPromptSend(): void {
  if (!lastConsumedPrompt) return;
  setPendingPrompt(lastConsumedPrompt.sessionId, lastConsumedPrompt.prompt);
  lastConsumedPrompt = null;
}

/** 注册提示词消费面(变换 + 发送失败回滚 + 仅提示词时空输入放行);返回反注册。 */
export function registerPendingPromptConsumption(): () => void {
  const offs = [
    registerComposerSendTransform(pendingPromptSendTransform),
    registerComposerSendUndo(undoPendingPromptSend),
    registerComposerEmptySendProvider(
      (sid) => !!sid && getPendingPrompt(sid) !== null,
    ),
  ];
  return () => offs.forEach((off) => off());
}
