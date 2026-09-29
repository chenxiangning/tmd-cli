/**
 * Skills 中央 tab 契约 ── 右栏面板「打开管理」按钮的 openTab 封装。
 * 单例 tab(id 即 kind,幂等:重复打开聚焦已有)。"Skills" 是专有面板名,
 * 各语言同形,不走词典。
 */

import { openTab } from "@kernel/tabs";

export const SKILL_HUB_TAB_KIND = "skill-hub";

export function openSkillHubTab(): void {
  openTab({
    id: SKILL_HUB_TAB_KIND,
    kind: SKILL_HUB_TAB_KIND,
    title: "Skills",
    path: SKILL_HUB_TAB_KIND,
    payload: {},
  });
}
