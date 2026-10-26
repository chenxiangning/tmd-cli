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

/** 通知静音档位:mute = 静音通知(ask 穿透)/ full = 完全静音 / snooze = 静音至回合结束。 */
export type SessionMuteMode = "mute" | "full" | "snooze";
export const SESSION_MUTE_MODES: readonly SessionMuteMode[] = ["mute", "full", "snooze"];

/** 单条静音记录:档位 + 静音时刻(ms);语义与三档 × 四类别矩阵见 kernel/sessionMutes.ts。
 *  askRing 仅 full 档语义:true = ask 穿透仍响铃;缺省 false = ask 亦静。 */
export interface SessionMuteEntry {
  mutedAt: number;
  mode: SessionMuteMode;
  askRing?: boolean;
}

/** 重启现场恢复设置:enabled 总闸(默认关,0.4.2 d94e046a 起不再默认开);keys = 三段身份 MRU 序
 *  (首 = 最新,`wsId:profileId:cliSessionId`),帽随 sessionTabsMax 动态读。
 *  语义与启动恢复编排见 kernel/sessionRestore.ts。 */
export interface SessionRestoreSettings {
  enabled: boolean;
  keys: string[];
}

/** 会话卫生清扫时窗(小时)白名单:12h / 24h / 48h / 7d。 */
export type SessionHygieneHours = 12 | 24 | 48 | 168;
export const SESSION_HYGIENE_HOURS: readonly SessionHygieneHours[] = [12, 24, 48, 168];
export const SESSION_HYGIENE_HOURS_DEFAULT: SessionHygieneHours = 24;

/** 会话输出日志保留天数白名单(Rust session_log_sweep 消费):7/30/90 天;0 = 关闭启动清理。 */
export type SessionLogRetentionDays = 7 | 30 | 90 | 0;
export const SESSION_LOG_RETENTION_DAYS: readonly SessionLogRetentionDays[] = [7, 30, 90, 0];
export const SESSION_LOG_RETENTION_DAYS_DEFAULT: SessionLogRetentionDays = 7;
