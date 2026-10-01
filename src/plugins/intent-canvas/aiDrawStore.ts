/**
 * 意图画布 · AI 作画开关(插件本地偏好,localStorage 持久化;
 * approval-inbox/academy 先例:单插件偏好不进 kernel settings)。
 */

import { useSyncExternalStore } from "react";

const KEY = "tmd.intentCanvas.aiDraw";

type AiDrawPref = { enabled: boolean };

function read(): AiDrawPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiDrawPref>;
      return { enabled: parsed.enabled !== false };
    }
  } catch {
    /* 损坏即回落默认开。 */
  }
  return { enabled: true };
}

let snapshot: AiDrawPref = read();
const listeners = new Set<() => void>();

function commit(next: AiDrawPref): void {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 持久化失败不阻断内存态。 */
  }
  listeners.forEach((fn) => fn());
}

export function aiDrawPref(): AiDrawPref {
  return snapshot;
}

export function setAiDrawEnabled(enabled: boolean): void {
  commit({ enabled });
}

export function subscribeAiDraw(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAiDrawEnabled(): boolean {
  return useSyncExternalStore(subscribeAiDraw, () => snapshot.enabled);
}


/* ---------- 会话级作图标识 ----------
 * composer 左下画布图标切换:开 = 本会话发送时注入 AI 作画指令段。
 * 内存态(会话结束自然失效),不入 localStorage;总闸 aiDrawPref().enabled 仍优先。 */

let drawModeBySession: Record<string, true> = {};

export function isSessionDrawMode(sessionId: string | null | undefined): boolean {
  return !!sessionId && drawModeBySession[sessionId] === true;
}

/** 切换该会话的作图标识。 */
export function toggleSessionDrawMode(sessionId: string, next: boolean): void {
  const bySession = { ...drawModeBySession };
  if (next) {
    bySession[sessionId] = true;
  } else {
    delete bySession[sessionId];
  }
  drawModeBySession = bySession;
  listeners.forEach((fn) => fn());
}

export function useSessionDrawMode(sessionId: string | null): boolean {
  return useSyncExternalStore(subscribeAiDraw, () => isSessionDrawMode(sessionId));
}


/* ---------- AI 作画导入通知 ----------
 * 发布方:activate 级常驻轮询(aiDrawPoller)导入成功即 publish;
 * 消费方:画布 tab(useAiDrawInbox 订阅 → 刷新索引 + 提示条)与 composer
 * rail toast。seq 单调递增,消费方以挂载时快照为基线,不吃陈旧通知。 */

export type AiDrawImportedCanvas = { id: string; title: string };

let importNotice: { seq: number; canvases: AiDrawImportedCanvas[] } | null = null;
let pollError: string | null = null;

export function publishAiDrawImport(canvases: AiDrawImportedCanvas[]): void {
  importNotice = { seq: (importNotice?.seq ?? 0) + 1, canvases };
  listeners.forEach((fn) => fn());
}

export function aiDrawImportNoticeSnapshot(): { seq: number; canvases: AiDrawImportedCanvas[] } | null {
  return importNotice;
}

/** 轮询错误快照(管理页错误条数据源);值不变不触发监听(防 2s 空重渲染)。 */
export function setAiDrawPollError(message: string | null): void {
  if (pollError === message) {
    return;
  }
  pollError = message;
  listeners.forEach((fn) => fn());
}

export function aiDrawPollErrorSnapshot(): string | null {
  return pollError;
}

export function useAiDrawImportNotice(): { seq: number; canvases: AiDrawImportedCanvas[] } | null {
  return useSyncExternalStore(subscribeAiDraw, aiDrawImportNoticeSnapshot);
}
