/**
 * 会话归档层 —— settings.sessionArchive 的领域 API。
 *
 * 与 sessionPins/sessionTitles 同属应用侧覆盖层:不写回 CLI 磁盘文件,
 * 单一代码路径。key = `${workspaceId}:${profileId}:${cliSessionId}`
 * (与置顶同构,三段身份缺一不可;未落盘的活会话无稳定身份,不可归档)。
 *
 * 语义:默认视图隐藏归档会话;「归档」视图反向只看归档项。
 * 展示与过滤在 workspace 插件(useCliSessionGroup),本模块只管存取。
 */

import { getSettingsState, updateSettings } from "./settings";
import type { SessionArchiveEntry } from "./settingsTypes";

export type { SessionArchiveEntry };

/** 归档 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 与置顶 key 同构。 */
export function sessionArchiveKey(
  workspaceId: string,
  profileId: string,
  cliSessionId: string,
): string {
  return `${workspaceId}:${profileId}:${cliSessionId}`;
}

/** 是否已归档。 */
export function isSessionArchived(key: string): boolean {
  return getSettingsState().settings.sessionArchive[key] !== undefined;
}

/** 归档;已归档时刷新时间戳(幂等)。 */
export function archiveSession(key: string): void {
  updateSettings({
    sessionArchive: {
      ...getSettingsState().settings.sessionArchive,
      [key]: { archivedAt: Date.now() },
    },
  });
}

/** 取消归档;未归档为 no-op。 */
export function unarchiveSession(key: string): void {
  const current = getSettingsState().settings.sessionArchive;
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  updateSettings({ sessionArchive: next });
}
