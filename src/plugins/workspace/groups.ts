/**
 * 工作区分组 —— 分组语义唯一落点(参考 codemoss useWorkspaces.ts 裁剪版)。
 * 数据归属:组定义/折叠态在 settings.json(workspaceGroups /
 * workspaceGroupCollapsedMap);工作区归属 groupId 在 workspaces.json
 * (kernel/workspace.assignWorkspaceGroup 持有)。
 * 与 codemoss 的差异:无 sortOrder(组序 = settings 数组序,组内 = workspaces
 * 数组序)、无 worktree 分支、无 copiesFolder。
 */

import { getSettingsState, updateSettings, useSettingsState } from "@kernel/settings";
import type { WorkspaceGroup } from "@kernel/settingsTypes";
import { t } from "@kernel/i18n";
import { assignWorkspaceGroup, getWorkspaces, useWorkspaces, type Workspace } from "@kernel/workspace";
import { useMemo } from "react";

/** 未分组保留名(大小写不敏感):禁用作组名(codemoss 同款 "Ungrouped" 保留)。 */
const RESERVED_GROUP_NAMES: Record<string, true> = { 未分组: true, ungrouped: true };

function groups(): WorkspaceGroup[] {
  return getSettingsState().settings.workspaceGroups;
}

/** 组名校验:trim 后为空 / 保留名 / 重名(大小写不敏感,excludeId 用于重命名自身豁免)。 */
export function validateGroupName(
  name: string,
  excludeId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return t("组名不能为空");
  if (RESERVED_GROUP_NAMES[trimmed.toLowerCase()]) return t("「未分组」是保留名,不能用作组名");
  /* 60 字与 settingsSanitize 截断同口径:超长当场拒绝,不落「重启后静默变短」。 */
  if (trimmed.length > 60) return t("组名过长(上限 60 字)");
  const dup = groups().some(
    (g) => g.id !== excludeId && g.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return dup ? t("组名已存在") : null;
}

export function createGroup(name: string): string | null {
  const err = validateGroupName(name);
  if (err) return err;
  const group: WorkspaceGroup = {
    id: `wsg-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim(),
  };
  updateSettings({ workspaceGroups: [...groups(), group] });
  return null;
}

export function renameGroup(id: string, name: string): string | null {
  const err = validateGroupName(name, id);
  if (err) return err;
  updateSettings({
    workspaceGroups: groups().map((g) => (g.id === id ? { ...g, name: name.trim() } : g)),
  });
  return null;
}

/** 删除组:组内工作区 groupId 全归 null 落回未分组(codemoss 同款),再移除组。 */
export function deleteGroup(id: string): void {
  for (const ws of getWorkspaces().filter((w) => w.groupId === id)) {
    assignWorkspaceGroup(ws.id, null);
  }
  updateSettings({ workspaceGroups: groups().filter((g) => g.id !== id) });
}

/** 组上/下移 = settings 数组换位。 */
export function moveGroup(id: string, dir: "up" | "down"): void {
  const list = [...groups()];
  const idx = list.findIndex((g) => g.id === id);
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= list.length) return;
  [list[idx], list[target]] = [list[target], list[idx]];
  updateSettings({ workspaceGroups: list });
}

/** 移动工作区到组:null = 未分组;非法 groupId 归一为 null(codemoss 同款)。 */
export function assignToGroup(workspaceId: string, groupId: string | null): void {
  const valid = groupId !== null && groups().some((g) => g.id === groupId) ? groupId : null;
  assignWorkspaceGroup(workspaceId, valid);
}

export interface GroupedWorkspaces {
  /** 未分组桶(保持 workspaces.json 数组序)。 */
  ungrouped: Workspace[];
  /** 命名组(settings 数组序),含空组 —— 侧栏跳过空组,设置页全量。 */
  named: { group: WorkspaceGroup; workspaces: Workspace[] }[];
}

/** 派生分桶:非法 groupId(组已删)只读兜底归未分组,不回写。 */
export function groupWorkspaces(
  list: Workspace[],
  groupList: WorkspaceGroup[],
): GroupedWorkspaces {
  const validIds = new Set(groupList.map((g) => g.id));
  const ungrouped: Workspace[] = [];
  const buckets = new Map<string, Workspace[]>(groupList.map((g) => [g.id, []]));
  for (const ws of list) {
    const gid = ws.groupId ?? null;
    const bucket = gid !== null && validIds.has(gid) ? buckets.get(gid) : undefined;
    (bucket ?? ungrouped).push(ws);
  }
  return {
    ungrouped,
    named: groupList.map((group) => ({ group, workspaces: buckets.get(group.id) ?? [] })),
  };
}

/** React 版派生:侧栏/菜单消费。 */
export function useGroupedWorkspaces(): GroupedWorkspaces {
  const { list } = useWorkspaces();
  const { settings } = useSettingsState();
  return useMemo(
    () => groupWorkspaces(list, settings.workspaceGroups),
    [list, settings.workspaceGroups],
  );
}

