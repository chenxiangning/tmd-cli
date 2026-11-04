/**
 * 设置 section 注册表 —— 设置面板的扩展点(同 fileVisual 模式)。
 *
 * 插件通过 ctx.registerSettingsSection 注册一个左侧导航项;
 * 每个 section 携带自己的 tabs(右侧内容区顶部的 tab 条)。
 * 注册表本身不渲染:渲染归 settings 插件的 SettingsPanel(overlay 挂点)。
 * 未注册 = 不渲染(目前已注册:settings 插件「基础设置」)。
 */

import type { ComponentType, ReactNode } from "react";
import { createSubscribable } from "./subscribable";

interface SettingsTabContribution {
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
  /** 一级导航组 id(2026-11-04 减法批次 F-03):只影响设置面板左侧导航的分组
   *  呈现,不改变 section 唯一性/删除语义/深链 id;缺省 = 不分组(平铺,
   *  旧行为)。取值须命中 SETTINGS_NAV_GROUPS,未知 id 按不分组兜底。 */
  navGroup?: string;
  tabs: SettingsTabContribution[];
}

/** 设置一级导航组(F-03 归组元数据):组只是导航壳,不拥有内容、不进注册表。 */
export interface SettingsNavGroup {
  /** 稳定 id(section.navGroup 引用值)。 */
  id: string;
  /** 组头文案(t() 键,词典见 kernel/locales)。 */
  label: string;
  /** 导航组排序,小的在前。 */
  order: number;
}

/** 七个导航组的产品默认(通用 → 系统与数据);section 逐组归入,组内仍按 section.order。 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  { id: "general", label: "通用", order: 10 },
  { id: "session-workspace", label: "会话与工作区", order: 20 },
  { id: "ai-config", label: "AI 配置", order: 30 },
  { id: "remote-access", label: "远程与访问", order: 40 },
  { id: "notify", label: "通知", order: 50 },
  { id: "workbench", label: "工作台与回顾", order: 60 },
  { id: "system", label: "系统与数据", order: 70 },
];

/** 组 id 查表(未知/缺省 → null,调用方按不分组兜底)。 */
export function settingsNavGroup(id: string | undefined): SettingsNavGroup | null {
  if (!id) return null;
  return SETTINGS_NAV_GROUPS.find((g) => g.id === id) ?? null;
}

const sections = new Map<string, SettingsSectionContribution>();
const store = createSubscribable<SettingsSectionContribution[]>([]);

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
  store.commit(sorted());
}

/** 撤销通道(激活失败回滚/熔断摘除):id 未存在时静默(幂等)。 */
export function removeSettingsSection(id: string): void {
  if (!sections.delete(id)) return;
  store.commit(sorted());
}

export function useSettingsSections(): SettingsSectionContribution[] {
  return store.useStore();
}
