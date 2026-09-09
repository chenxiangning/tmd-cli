/**
 * 会话删除意图层 —— settings.sessionDeleted 的领域 API(tombstone)。
 *
 * 原则:删除被调用 = 用户意图就是删除,意图归 tmd-cli 所有。后台删盘
 * (fs_remove_path / 单库 CLI 的 deleteSession 钩子)失败报错时,管理态清理
 * 与列表隐藏照常生效,不得让会话在重扫中复活;磁盘数据保留并 console.warn
 * 诊断(调用方 sessionOps 负责记)。
 *
 * 与 sessionPins/sessionTitles/sessionArchive 同属应用侧覆盖层:key =
 * `${workspaceId}:${profileId}:${cliSessionId}`(三段身份,与置顶同构)。
 * 展示过滤在 workspace 插件(useCliSessionGroup / PinnedSessions)。
 * 会话 id 是各 CLI 的 uuid,不复用,mark 过的 key 永不误伤新会话。
 */

import type { SessionDeletedEntry } from "./settingsTypes";
import { makeOverlay, sessionOverlayKey } from "./overlayEvict";

export type { SessionDeletedEntry };

/** 删除意图 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 与置顶 key 同构。 */
export const sessionDeletedKey = sessionOverlayKey;

const overlay = makeOverlay<SessionDeletedEntry>("sessionDeleted", "deletedAt");

/** 是否已被用户删除(意图在册,列表隐藏)。 */
export const isSessionDeleted = overlay.has;

/**
 * 记录删除意图;已在册时刷新时间戳(幂等);容量满(200)时逐出 deletedAt 最旧条目。
 * 删除成功路径同样在册 —— id 不复用,残留 key 无害,且让「删除后重扫前」的
 * 窗口期内行也即时隐藏,不闪现。
 */
export const markSessionDeleted = overlay.mark;
