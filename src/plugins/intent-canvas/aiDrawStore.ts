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
