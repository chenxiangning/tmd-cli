/**
 * 会话通知静音层 —— settings.sessionMutes 的领域 API。
 *
 * 与 sessionPins/sessionArchive/sessionDeleted/sessionKeep 同属应用侧覆盖层:
 * key = `${workspaceId}:${profileId}:${cliSessionId}`(三段身份,经 sessionOverlayKey)。
 * 三段 key 以磁盘身份为锚,跨 resume 存活(resume 换壳 tmd id 变、磁盘 id 不变,
 * 见 anchorJump);claude fork 出的新磁盘会话 id 不同即新身份,不追踪继承
 * [INFERENCE 边界:以真实 fork 行为为准,如需继承另立迁移]。
 *
 * 语义:静音只拦 OS 通知与应用内提示音,通知中心流水照记(流水不受任何闸,
 * recordNotifyEntry 先于闸)。三档:
 * - "mute"   静音通知:拦 turnEnd/exit/quota,ask 穿透(免「盲等确认」事故);
 * - "full"   完全静音:拦全部;askRing=true 时 ask 穿透(同 mute 的安全默认);
 * - "snooze" 静音至回合结束:拦 turnEnd/quota,ask 与 exit 穿透 —— exit 穿透防
 *   entry 等不到 turnSettled 自清;turnSettled 时消费方调 clearSnooze 到期自清。
 *
 * quota 腿铁律:静音拦截绝不写 notify-log 的 quotaSeen —— 那是跨重启去重键,
 * 误写 = 本窗口周期永久静默;拦截点在 record 之后、sendOsNotification 之前,
 * markQuotaSeen 照常由 poll 判定侧维护,与本闸无关。
 */

import { t } from "./i18n";
import {
  getSettingsState,
  updateSettings,
  SESSION_MUTE_MODES,
  type SessionMuteEntry,
  type SessionMuteMode,
} from "./settings";
import { sessionOverlayKey } from "./overlayEvict";

export type { SessionMuteEntry, SessionMuteMode };
export { SESSION_MUTE_MODES };

/** 静音 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 三段身份缺一不可。 */
export const sessionMuteKey = sessionOverlayKey;

/** 上限:与归档/保留层同量级(2000);sanitize 按此帽确定性截断(单源可改)。 */
export const SESSION_MUTES_MAX = 2000;

/** 受静音闸的通知类别(与 notify/logic.ts 的 NotifyKind 同值集)。 */
export type MuteKind = "ask" | "turnEnd" | "exit" | "quota";

/** 档位显示名(t() 中文源串;右键菜单/通知中心/设置概览卡共用)。 */
export function sessionMuteModeLabel(mode: SessionMuteMode): string {
  if (mode === "full") return t("完全静音");
  if (mode === "snooze") return t("静音至回合结束");
  return t("静音通知");
}

/**
 * 三档 × 四类别判定矩阵(纯函数):true = 拦 OS/声音。
 * ask 仅 full 且 askRing !== true 时静;exit 仅 snooze 放行;turnEnd/quota 三档全静。
 */
export function mutedKinds(entry: SessionMuteEntry | undefined, kind: MuteKind): boolean {
  if (!entry) return false;
  if (kind === "ask") return entry.mode === "full" && entry.askRing !== true;
  if (kind === "exit") return entry.mode !== "snooze";
  return true;
}

/** 读取静音记录;未静音返回 undefined。 */
export function getSessionMute(key: string): SessionMuteEntry | undefined {
  return getSettingsState().settings.sessionMutes[key];
}

/** 静音到指定档位(重复调用 = 换档,刷新 mutedAt);askRing 仅 full 档语义。 */
export function muteSession(key: string, mode: SessionMuteMode, askRing?: boolean): void {
  const current = getSettingsState().settings.sessionMutes;
  updateSettings({
    sessionMutes: {
      ...current,
      [key]: { mutedAt: Date.now(), mode, ...(askRing === true ? { askRing: true } : {}) },
    },
  });
}

/** 取消静音(不分档);未静音为 no-op。 */
export function unmuteSession(key: string): void {
  const current = getSettingsState().settings.sessionMutes;
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  updateSettings({ sessionMutes: next });
}

/** snooze 到期自清(turnSettled 消费侧调):只清 snooze 档,手动档不被事件误撤。 */
export function clearSnooze(key: string): void {
  if (getSettingsState().settings.sessionMutes[key]?.mode !== "snooze") return;
  unmuteSession(key);
}

/** 会话身份最小面(生产传 host,测试传桩;同 notify/logic.ts SessionLookup 先例)。 */
export interface SessionMuteLookup {
  getSessions(): Array<{ id: string; workspaceId?: string; profileId: string }>;
  getCliSessionId(sessionId: string): string | undefined;
}

/** tmd 活会话 id → 覆盖层 key;无 workspaceId 或未落盘(无 cliSessionId)= undefined
 *  (未落盘会话无稳定身份,不进覆盖层,行为与无静音完全一致)。 */
export function tmdSessionMuteKey(sessionId: string, lookup: SessionMuteLookup): string | undefined {
  const meta = lookup.getSessions().find((s) => s.id === sessionId);
  if (!meta?.workspaceId) return undefined;
  return muteKeyOf(meta.workspaceId, meta.profileId, lookup.getCliSessionId(sessionId));
}

/** 显式身份 → 覆盖层 key;cliSessionId 缺失(未落盘)返回 undefined。 */
export function muteKeyOf(
  workspaceId: string,
  profileId: string,
  cliSessionId: string | undefined,
): string | undefined {
  return cliSessionId === undefined ? undefined : sessionMuteKey(workspaceId, profileId, cliSessionId);
}
