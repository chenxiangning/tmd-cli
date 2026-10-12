/**
 * 工作台 · 任务卡片挂载(对话框数据面)—— 开新会话发起时不再把任务上下文
 * 整段灌进输入框,改为挂「任务卡片」:composer.attachments 芯片展示
 * (TaskCardChip,接力芯片同款先例),点卡片可编辑全文,发送变换前置拼装
 * (relayCarry 同款乐观口径:变换内消费,全部目标写失败经 undo 恢复),
 * 空输入 = 仅卡片(任务发起常态,经 registerComposerEmptySendProvider 放行)。
 */

import { useSyncExternalStore } from "react";
import type { ComposerSendTransform } from "@kernel/composerExt";

/** 挂到会话 composer 的任务卡片(title = 发起时填写的关联会话名称)。 */
export interface PendingTaskCard {
  projectId: string;
  taskId: string;
  title: string;
  text: string;
}

/* 与接力芯片同款 LRU 上限:极端狂点不发也不无界增长。 */
const MAX_PENDING_CARDS = 8;
const pendingCards = new Map<string, PendingTaskCard>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribePendingTaskCard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingTaskCard(sessionId: string): PendingTaskCard | null {
  return pendingCards.get(sessionId) ?? null;
}

export function setPendingTaskCard(sessionId: string, card: PendingTaskCard): void {
  pendingCards.delete(sessionId);
  pendingCards.set(sessionId, card);
  while (pendingCards.size > MAX_PENDING_CARDS) {
    const oldest = pendingCards.keys().next().value;
    if (oldest === undefined) break;
    pendingCards.delete(oldest);
  }
  emit();
}

export function dropPendingTaskCard(sessionId: string): void {
  if (pendingCards.delete(sessionId)) emit();
}

export function usePendingTaskCard(sessionId: string | null): PendingTaskCard | null {
  return useSyncExternalStore(
    subscribePendingTaskCard,
    () => (sessionId ? getPendingTaskCard(sessionId) : null),
  );
}

let lastConsumed: { sessionId: string; card: PendingTaskCard } | null = null;

export const taskCardSendTransform: ComposerSendTransform = (text, sessionId) => {
  if (!sessionId) return text;
  const card = getPendingTaskCard(sessionId);
  if (!card) return text;
  lastConsumed = { sessionId, card };
  dropPendingTaskCard(sessionId);
  return text ? `${card.text}\n\n${text}` : card.text;
};

/** 发送失败回滚:恢复被消费的卡片(单次发送语义,同 undoRelaySend)。 */
export function undoTaskCardSend(): void {
  if (!lastConsumed) return;
  setPendingTaskCard(lastConsumed.sessionId, lastConsumed.card);
  lastConsumed = null;
}
