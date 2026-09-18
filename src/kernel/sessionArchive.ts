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

import type { SessionArchiveEntry } from "./settingsTypes";
import { makeOverlay, sessionOverlayKey } from "./overlayEvict";

export type { SessionArchiveEntry };

/** 归档 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 与置顶 key 同构。 */
export const sessionArchiveKey = sessionOverlayKey;

/* 自动归档(干净退出即写)密度 ~20 会话/天,200 上限 ~10 天触顶逐出,
 * 与 settingsSanitizeSessions.SESSION_ARCHIVE_MAX_ENTRIES 双源同步(改须同改)。 */
export const SESSION_ARCHIVE_MAX = 2000;
const overlay = makeOverlay<SessionArchiveEntry>("sessionArchive", "archivedAt", SESSION_ARCHIVE_MAX);

/** 是否已归档。 */
export const isSessionArchived = overlay.has;

/** 归档;已归档时刷新时间戳(幂等);满额(2000)时逐出 archivedAt 最旧的条目(零数据损失)。 */
export const archiveSession = overlay.mark;

/** 批量归档(会话卫生清扫入口):整表合并 + 逐出后单次写盘,语义与 archiveSession 同。 */
export const archiveSessions = overlay.markMany;

/** 取消归档;未归档为 no-op。 */
export const unarchiveSession = overlay.unmark;
