/**
 * 设置导航分组纯逻辑(F-03)——「组 → 原 section」归并,组件文件不导出非组件铁则。
 *
 * 组只是导航壳:section 的 id/order/tab 全不动,分组只影响 SettingsPanel
 * 左导航的呈现;未知/缺省 navGroup 的 section 平铺在各组之后(回滚语义:
 * 旧插件不带 navGroup 注册时导航退化为平铺,不丢 section)。
 */

import {
  settingsNavGroup,
  type SettingsNavGroup,
  type SettingsSectionContribution,
} from "@kernel/settingsRegistry";

export interface SettingsNavEntry {
  /** null = 不分组兜底段(组头不渲染,section 平铺)。 */
  group: SettingsNavGroup | null;
  sections: SettingsSectionContribution[];
}

/** 已排序 section 列表按导航组定义序归并;组内保持传入顺序(注册表已按 order 排)。 */
export function groupSettingsSections(
  sections: readonly SettingsSectionContribution[],
  groups: readonly SettingsNavGroup[],
): SettingsNavEntry[] {
  const entries: SettingsNavEntry[] = groups
    .map((g) => ({
      group: g,
      sections: sections.filter((s) => settingsNavGroup(s.navGroup)?.id === g.id),
    }))
    .filter((e) => e.sections.length > 0);
  const rest = sections.filter((s) => !settingsNavGroup(s.navGroup));
  if (rest.length > 0) entries.push({ group: null, sections: rest });
  return entries;
}
