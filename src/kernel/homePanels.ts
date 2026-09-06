/**
 * 首页引擎卡扩展面板注册表 —— 引擎插件为自家 welcome 卡片贡献下方面板
 * (同 filePanel/marketPanel 模式:activate 内经 ctx 登记,重复 id 抛错)。
 * 注册表按 CliProfile.id 索引,welcome 引擎列表原位渲染;注册表不感知
 * 面板内容(如 dsh 的本地 host 连接引导)。
 */

import type { ComponentType } from "react";
import { useSyncExternalStore } from "react";

const panels = new Map<string, ComponentType>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, ComponentType> = new Map();

/** 注册一个首页引擎面板(键 = 该插件的 CliProfile.id)。重复 id 视为冲突。 */
export function registerHomePanel(profileId: string, panel: ComponentType): void {
  if (panels.has(profileId)) {
    throw new Error(`首页引擎面板重复注册: ${profileId}`);
  }
  panels.set(profileId, panel);
  snapshot = new Map(panels);
  listeners.forEach((fn) => fn());
}

export function getHomePanel(profileId: string): ComponentType | undefined {
  return snapshot.get(profileId);
}

export function useHomePanels(): ReadonlyMap<string, ComponentType> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
