/**
 * 会话归档层 —— settings.sessionArchive 的领域 API。
 *
 * 与 sessionPins/sessionTitles 同属应用侧覆盖层:不写回 CLI 磁盘文件,
 * 单一代码路径。key = `${workspaceId}:${profileId}:${cliSessionId}`
 * (与置顶同构,三段身份缺一不可;未落盘的活会话无稳定身份,不可归档)。
 *
 * 语义:归档是「左侧栏显示语义」—— 默认视图隐藏归档会话;「归档」视图反向只看
 * 归档项。展示与过滤在 workspace 插件(useCliSessionGroup),本模块只管存取。
 * 直接列磁盘会话的其余消费方(如 welcome 欢迎页最近会话)不在过滤范围内,
 * 这是有意边界(归档 ≠ 全应用隐藏)。
 */


import { getSettingsState, updateSettings } from "./settings";
import type { SessionArchiveEntry } from "./settingsTypes";
import { evictOldest } from "./overlayEvict";

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

/** 归档层容量:与置顶同款 200 条上限;写路径同限,满额逐出最旧(与 sanitize 逐出对称)。 */
const SESSION_ARCHIVE_MAX_ENTRIES = 200;

/**
 * 归档;已归档时刷新时间戳(幂等);容量满(200)时逐出 archivedAt 最旧的条目。
 * 归档条目只是可见性覆盖层(时间戳,无内容),逐出无数据损失;曾用「拒绝新 key」,
 * 200 条封顶后用户每次归档都静默无效(2026-09-07 实测踩坑:归档"时灵时不灵")。
 */
export function archiveSession(key: string): void {
  const current = getSettingsState().settings.sessionArchive;
  const next = { ...current, [key]: { archivedAt: Date.now() } };
  evictOldest(next, current, key, (e) => e.archivedAt, SESSION_ARCHIVE_MAX_ENTRIES);
  updateSettings({ sessionArchive: next });
}

/** 取消归档;未归档为 no-op。 */
export function unarchiveSession(key: string): void {
  const current = getSettingsState().settings.sessionArchive;
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  updateSettings({ sessionArchive: next });
}
