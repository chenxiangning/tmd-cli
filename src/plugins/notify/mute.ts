/**
 * 通知静音闸接线(dispatch 侧判定;logic.ts 的 shouldNotify 签名不动)。
 * key = 三段覆盖层身份(kernel/sessionMutes);未落盘会话无稳定身份 = 不静音,
 * 行为与无覆盖层完全一致。只拦 OS/声音,通知中心流水照记;quota 腿绝不写
 * quotaSeen(跨周期去重键,误写 = 永久静默),markQuotaSeen 归 poll 判定侧。
 *
 * 「不写 quotaSeen」为结构保证,不设 notify/index 层专测:
 * 1) 本模块与 index.tsx 的静音判定路径均不 import ./log 的 markQuotaSeen ——
 *    TS import 图上闸与 quotaSeen 写入零交集,误写无法通过编译;
 * 2) markQuotaSeen 仅存在于 poll 的三个判定腿(claudeWindow/pickQuotaWarnings/
 *    pickBalanceWarning),先于 fireQuota 执行,不受本闸影响;
 * 3) index 层专测需完整插件激活桩(registerFilePanel/registerSettingsSection 的
 *    JSX、bootNotifyLog 的 fs IPC、window 监听),成本远超一条 import 断言。
 * 语义备注:静音会话的窗口告警照常消耗本周期的一次去重额(quotaSeen 在判定侧
 * 落键),同窗口期不会反复打扰 —— 这是跨周期去重语义,非本闸职责。
 */

import type { SessionExitedDetailEvent } from "@kernel/events";
import { host } from "@kernel/host";
import { getSessionMute, mutedKinds, sessionMuteKey, tmdSessionMuteKey, type MuteKind } from "@kernel/sessionMutes";

/** 按 key 判静音(undefined = 身份不全,不静音)。 */
function isMutedKey(key: string | undefined, kind: MuteKind): boolean {
  return key !== undefined && mutedKinds(getSessionMute(key), kind);
}

/** 活会话静音判定(tmd id → 三段 key;未落盘 = 不静音)。 */
export function isSessionMuted(sessionId: string, kind: MuteKind): boolean {
  return isMutedKey(tmdSessionMuteKey(sessionId, host), kind);
}

/** exit 详情静音判定:身份取自移除前快照(活会话表已查不到);snooze 档放行 exit
 *  —— 会话死亡即回合异常终局,静了 entry 等不到 turnSettled 自清。 */
export function isExitMuted(e: SessionExitedDetailEvent): boolean {
  const key =
    e.workspaceId !== undefined && e.cliSessionId !== undefined
      ? sessionMuteKey(e.workspaceId, e.profileId, e.cliSessionId)
      : undefined;
  return isMutedKey(key, "exit");
}
