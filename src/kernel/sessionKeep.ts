/**
 * 会话保留层 —— settings.sessionKeep 的领域 API。
 *
 * 与 sessionArchive/sessionDeleted/sessionPins 同属应用侧覆盖层:key =
 * `${workspaceId}:${profileId}:${cliSessionId}`(三段身份,与归档同构)。
 *
 * 语义:用户**手动**取消归档一条会话 = 显式表达「这条要留在默认视图」。
 * 会话卫生清扫(workspace/sessionSweep:超期自动归档 + 空会话删除)据此跳过,
 * 否则归档视图里刚恢复的旧会话下一次扫描就被重新归档 —— 取消动作形同无效。
 *
 * 有意不写 keep 的路径:`host.openDiskSession` 的自动 unarchive(resume 打开)——
 * 打开即用,CLI 会刷新 mtime 自然脱离过期区;之后干净退出(session-board/boardExit)
 * 照常再归档。若写 keep,「打开过一次的旧会话」将永远脱离清扫。
 *
 * 展示过滤在 workspace 插件(useCliSessionGroup 的清扫门控),本模块只管存取。
 */

import type { SessionKeepEntry } from "./settingsTypes";
import { makeOverlay, sessionOverlayKey } from "./overlayEvict";

export type { SessionKeepEntry };

/** 保留 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 与归档 key 同构。 */
export const sessionKeepKey = sessionOverlayKey;

const overlay = makeOverlay<SessionKeepEntry>("sessionKeep", "keptAt");

/** 是否已标记保留(清扫跳过)。 */
export const isSessionKept = overlay.has;

/** 标记保留;已标记时刷新时间戳(幂等);满额(200)逐出 keptAt 最旧条目。 */
export const keepSession = overlay.mark;

/** 取消保留;未标记为 no-op。重新归档一条 keep 过的会话时调用(手动归档 = 撤回保留意图)。 */
export const unkeepSession = overlay.unmark;
