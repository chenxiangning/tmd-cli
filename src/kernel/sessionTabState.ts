/**
 * 会话 tab 状态推导 —— 并行会话三态可见性的唯一数据源(SessionTabBar 点位 + 标题后缀)。
 * 输入全部来自 host 既有状态位(isWaitingConfirm/isTurnActive/isUnread/getLastActivityAt),
 * 零新检测;优先级契约见 sessionTabState.test.ts 真值表。
 * 背景动机见 docs/review/2026-09-29-ask-badge-geometry-reliability-review.md 同族:
 * 空闲(提示符待输入)与死的观感不可分,2026-09-29 用户实证误杀活会话。
 */

/** tab 态:waiting=等待确认(绿呼吸点+后缀)/ running=轮次在途(绿静止点)/ unread=结算未读(蓝点,既有)/ idle=空闲待输入(灰点+后缀)/ none=无对话基线(不出点)。 */
export type SessionTabState = "waiting" | "running" | "unread" | "idle" | "none";

/** 优先级:等待确认 > 无基线 > 运行中 > 未读 > 空闲。 */
export function sessionTabState(
  waiting: boolean,
  turnActive: boolean,
  unread: boolean,
  lastActivityAt: number,
): SessionTabState {
  if (waiting) return "waiting";
  if (lastActivityAt === 0) return "none";
  if (turnActive) return "running";
  if (unread) return "unread";
  return "idle";
}
