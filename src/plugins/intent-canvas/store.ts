/**
 * 意图画布 · 附件桥(mossx attach-to-thread 的 tmd-cli 对应物)。
 * 编辑器「关联当前会话」→ 文档进 pending 队列 → composer 附件芯片条可见,
 * 发送时 sendTransform 把压缩 JSON 上下文拼进 prompt 并清空 pending,
 * 发送失败由 undo 恢复。按会话分桶,不跨会话串扰。
 */

import { useSyncExternalStore } from "react";
import type { IntentCanvasDocument } from "./types";

type State = { pending: Record<string, IntentCanvasDocument[] | undefined> };

/** useSyncExternalStore 的 getSnapshot 必须返回缓存值:空桶回这个常量,防无限重渲染。 */
const EMPTY_PENDING: IntentCanvasDocument[] = [];

let state: State = { pending: {} };
const listeners = new Set<() => void>();

function emit(next: State): void {
  state = next;
  listeners.forEach((fn) => fn());
}

export function subscribeAttachments(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function attachmentsSnapshot(): State {
  return state;
}

export function usePendingAttachments(sessionId: string | null): IntentCanvasDocument[] {
  return useSyncExternalStore(subscribeAttachments, () =>
    (sessionId ? state.pending[sessionId] : undefined) ?? EMPTY_PENDING,
  );
}

/** 编辑器「关联当前会话」:入 pending(同画布幂等,后到覆盖)。 */
export function stageAttachment(sessionId: string | null, document: IntentCanvasDocument): void {
  if (!sessionId) {
    return;
  }
  const list = (state.pending[sessionId] ?? []).filter((d) => d.id !== document.id);
  emit({ pending: { ...state.pending, [sessionId]: [...list, document] } });
}

export function unstageAttachment(sessionId: string, documentId: string): void {
  const list = (state.pending[sessionId] ?? []).filter((d) => d.id !== documentId);
  emit({ pending: { ...state.pending, [sessionId]: list } });
}

/** 发送成功:清空该会话 pending;记录快照供 undo 恢复。 */
export function consumeAttachments(sessionId: string): IntentCanvasDocument[] {
  const consumed = state.pending[sessionId] ?? [];
  if (consumed.length > 0) {
    emit({ pending: { ...state.pending, [sessionId]: [] } });
  }
  return consumed;
}

export function restoreAttachments(sessionId: string, documents: IntentCanvasDocument[]): void {
  if (documents.length === 0) {
    return;
  }
  /* 合并非整桶替换:发送失败 undo 前用户可能重新暂存了新画布,旧快照只补回
     已消失的条目,不覆盖窗口期的新暂存(评审 P2)。 */
  const currentIds = new Set((state.pending[sessionId] ?? []).map((d) => d.id));
  const restored = documents.filter((d) => !currentIds.has(d.id));
  if (restored.length === 0) {
    return;
  }
  emit({ pending: { ...state.pending, [sessionId]: [...restored, ...(state.pending[sessionId] ?? [])] } });
}

/** 会话退出清理:pending 桶与作图标识随会话生命周期释放(插件 activate 挂
 *  kernel.sessions.exited;评审 P2 内存单调增长)。 */
export function purgeSessionState(sessionId: string): void {
  if (!(sessionId in state.pending)) {
    return;
  }
  const pending = { ...state.pending };
  delete pending[sessionId];
  emit({ pending });
}
