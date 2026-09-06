/**
 * 会话中央面覆盖注册表 —— 某些 CLI 的对话面不在 PTY 幕布里(如 dsh:只有
 * web profile,聊天 UI 由其本地 host 服务提供)。插件按 CliProfile.id 注册
 * 一个组件替换该 profile 会话的 terminal 面板位(app-shell MainPanel 消费,
 * 同 homePanels/marketPanel 惯例:activate 内经 ctx 登记,重复 id 抛错)。
 * 内核不理解覆盖面内容(dsh 的 origin 知识留在插件侧)。
 */

import type { ComponentType } from "react";
import { useSyncExternalStore } from "react";

/** 覆盖组件收到的 props:当前激活会话 id。 */
export interface SessionCanvasProps {
  sessionId: string;
}

const canvases = new Map<string, ComponentType<SessionCanvasProps>>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, ComponentType<SessionCanvasProps>> = new Map();

/** 注册某 profile 的会话中央面(键 = CliProfile.id)。重复 id 视为冲突。 */
export function registerSessionCanvas(
  profileId: string,
  component: ComponentType<SessionCanvasProps>,
): void {
  if (canvases.has(profileId)) {
    throw new Error(`会话中央面重复注册: ${profileId}`);
  }
  canvases.set(profileId, component);
  snapshot = new Map(canvases);
  listeners.forEach((fn) => fn());
}

export function getSessionCanvas(
  profileId: string,
): ComponentType<SessionCanvasProps> | undefined {
  return snapshot.get(profileId);
}

export function useSessionCanvases(): ReadonlyMap<string, ComponentType<SessionCanvasProps>> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
