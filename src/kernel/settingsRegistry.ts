/**
 * 设置 section 注册表 —— 设置面板的扩展点(同 fileHighlighter/fileVisual 模式)。
 *
 * 插件通过 ctx.registerSettingsSection 注册一个左侧导航项;
 * 每个 section 携带自己的 tabs(右侧内容区顶部的 tab 条)。
 * 注册表本身不渲染:渲染归 settings 插件的 SettingsPanel(overlay 挂点)。
 * 未注册 = 不渲染(一期只有 settings 插件注册的「基础设置」)。
 */

import type { ComponentType, ReactNode } from "react";
import { useSyncExternalStore } from "react";

export interface SettingsTabContribution {
  /** section 内唯一,如 "appearance"。 */
  id: string;
  title: string;
  icon?: ReactNode;
  /** 同 section 内排序,小的在前。 */
  order?: number;
  component: ComponentType;
}

export interface SettingsSectionContribution {
  /** 全局唯一,如 "basic"。 */
  id: string;
  title: string;
  /** 副标题(内容区大标题下的描述行)。 */
  description?: string;
  icon?: ReactNode;
  /** 导航排序,小的在前。 */
  order?: number;
  tabs: SettingsTabContribution[];
}

const sections = new Map<string, SettingsSectionContribution>();
const listeners = new Set<() => void>();
let snapshot: SettingsSectionContribution[] = [];

function sorted(): SettingsSectionContribution[] {
  return [...sections.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** 注册一个设置 section。重复 id 视为冲突(插件 bug),直接抛错。 */
export function registerSettingsSection(section: SettingsSectionContribution): void {
  if (sections.has(section.id)) {
    throw new Error(`设置 section 重复注册: ${section.id}`);
  }
  sections.set(section.id, {
    ...section,
    tabs: [...section.tabs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  });
  snapshot = sorted();
  listeners.forEach((fn) => fn());
}

export function useSettingsSections(): SettingsSectionContribution[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
