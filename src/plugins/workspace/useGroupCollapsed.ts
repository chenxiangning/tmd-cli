/**
 * 会话分类折叠态 hook —— settings.workspaceGroupCollapsedMap 读写。
 * key = `${workspaceId}:${groupId}`(groupId = CLI profileId 或 "shell"/"ssh");
 * 缺失记录默认折叠(与工作区级 workspaceCollapsedMap 同语义);
 * 切换经 updateSettings 写盘,重启 sanitize 恢复。spec:2026-09-06-workspace-group-collapse。
 */

import { updateSettings, useSettingsState } from "@kernel/settings";

export function useGroupCollapsed(
  workspaceId: string,
  groupId: string,
): { collapsed: boolean; toggle: () => void } {
  const { settings } = useSettingsState();
  const key = `${workspaceId}:${groupId}`;
  const collapsed = settings.workspaceGroupCollapsedMap[key] ?? true;
  const toggle = () =>
    updateSettings({
      workspaceGroupCollapsedMap: {
        ...settings.workspaceGroupCollapsedMap,
        [key]: !collapsed,
      },
    });
  return { collapsed, toggle };
}
