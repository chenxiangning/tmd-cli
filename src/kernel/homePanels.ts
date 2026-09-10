/**
 * 首页引擎卡扩展面板注册表 —— 引擎插件为自家 welcome 卡片贡献下方面板
 * (同 filePanel/marketPanel 模式:activate 内经 ctx 登记,重复 id 抛错)。
 * 注册表按 CliProfile.id 索引,welcome 引擎列表原位渲染;注册表不感知
 * 面板内容(如 dsh 的本地 host 连接引导)。
 */

import type { ComponentType } from "react";
import { createSubscribable } from "./subscribable";

const panels = new Map<string, ComponentType>();
const store = createSubscribable<ReadonlyMap<string, ComponentType>>(new Map());

/** 注册一个首页引擎面板(键 = 该插件的 CliProfile.id)。重复 id 视为冲突。 */
export function registerHomePanel(profileId: string, panel: ComponentType): void {
  if (panels.has(profileId)) {
    throw new Error(`首页引擎面板重复注册: ${profileId}`);
  }
  panels.set(profileId, panel);
  store.commit(new Map(panels));
}

/** 撤销通道(激活失败回滚/熔断摘除):profileId 未注册时静默(幂等)。 */
export function removeHomePanel(profileId: string): void {
  if (!panels.delete(profileId)) return;
  store.commit(new Map(panels));
}

export function useHomePanels(): ReadonlyMap<string, ComponentType> {
  return store.useStore();
}
