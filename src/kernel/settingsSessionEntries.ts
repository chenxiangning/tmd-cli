/**
 * 会话覆盖层记录类型(置顶/归档/删除/保留/卫生时窗)——
 * 自 settingsTypes.ts 拆出守 300 行铁则;消费面经 settingsTypes 再出口不变。
 */

/** 置顶作用域:"global" = 左侧栏全局置顶区;"workspace" = 工作区 CLI 分组内顶部。 */
export type SessionPinScope = "global" | "workspace";

/** 单条置顶记录:作用域 + 置顶时间戳(ms) + 标题快照。 */
export interface SessionPinEntry {
  scope: SessionPinScope;
  pinnedAt: number;
  title: string;
}

/** 单条归档记录:仅归档时间戳(ms);归档语义见 kernel/sessionArchive.ts。 */
export interface SessionArchiveEntry {
  archivedAt: number;
}

/** 单条删除意图(tombstone)记录:仅删除时间戳(ms);语义见 kernel/sessionDeleted.ts。
 *  后台删盘失败时管理态仍删除并隐藏,磁盘数据保留(用户意图归 tmd-cli 所有)。 */
export interface SessionDeletedEntry {
  deletedAt: number;
}

/** 单条保留标记记录:仅标记时间戳(ms);语义见 kernel/sessionKeep.ts。
 *  手动取消归档时写入,会话卫生清扫据此跳过(防「取消归档又被扫回」)。 */
export interface SessionKeepEntry {
  keptAt: number;
}

/** 会话卫生清扫时窗(小时)白名单:12h / 24h / 48h / 7d。 */
export type SessionHygieneHours = 12 | 24 | 48 | 168;
export const SESSION_HYGIENE_HOURS: readonly SessionHygieneHours[] = [12, 24, 48, 168];
export const SESSION_HYGIENE_HOURS_DEFAULT: SessionHygieneHours = 24;
