/**
 * 工作区设置域清洗 —— 自 settingsSanitize.ts 拆出(300 行铁则;先例
 * settingsSanitizeSessions.ts)。承担:折叠图 + 分组清单;装配仍在
 * settingsSanitize.ts 的 sanitize()。
 */

import type { WorkspaceGroup } from "./settingsTypes";

/** 工作区折叠图上限(与置顶/归档同款确定性兜底口径)。 */
const WORKSPACE_COLLAPSED_MAX_ENTRIES = 200;

/** 工作区折叠态清洗:只收 boolean 值,按 key 序限量纳入(与置顶同款确定性兜底)。 */
export function sanitizeWorkspaceCollapsedMap(raw: unknown): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort().slice(0, WORKSPACE_COLLAPSED_MAX_ENTRIES)) {
    if (typeof entries[key] === "boolean") map[key] = entries[key] as boolean;
  }
  return map;
}

/** 分组清单上限(与折叠图同款确定性兜底口径)。 */
const WORKSPACE_GROUPS_MAX = 100;

/** 工作区分组清洗:id/name 须为非空字符串,name trim 后为空丢弃,超长截断。 */
export function sanitizeWorkspaceGroups(raw: unknown): WorkspaceGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: WorkspaceGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (groups.length >= WORKSPACE_GROUPS_MAX) break;
    if (!item || typeof item !== "object") continue;
    const { id, name } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    seen.add(id);
    groups.push({ id, name: name.trim().slice(0, 60) });
  }
  return groups;
}
