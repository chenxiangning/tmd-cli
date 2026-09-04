import { shortId } from "@kernel/sessionTitles";
import type { SessionMeta } from "@kernel/ipc";

/**
 * 活会话列表比较器:完成未读置顶,其余按 spawn 时间倒序。
 * 排序键必须是稳定身份(createdAt),绝不能用 lastActivityAt —— 它随每个输出
 * chunk 变化,做排序键会让同时流式输出的会话行位置反复互换(列表抖动事故根因)。
 * createdAt 缺失按 0;同毫秒 tie-break 用 id,保证跨渲染确定性。
 */
export function compareLiveSessions(
  a: SessionMeta,
  b: SessionMeta,
  isUnread: (id: string) => boolean,
): number {
  const ua = isUnread(a.id) ? 0 : 1;
  const ub = isUnread(b.id) ? 0 : 1;
  if (ua !== ub) return ua - ub;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id.localeCompare(a.id);
}

/**
 * 置顶快照有效性:短码垃圾(历史缺陷把 shortId 当快照持久化)视为无快照。
 * 判定用精确等值 —— 垃圾快照正是 shortId(cliSessionId) 的产物,不做模式猜测。
 */
export function realPinSnapshot(
  snapshot: string,
  cliSessionId: string,
): string | undefined {
  return snapshot && snapshot !== shortId(cliSessionId) ? snapshot : undefined;
}

/**
 * 活会话状态(内核 activityWatch 口径;首写闸:用户首写前的输出不算对话,
 * lastActivityAt 保持 0):
 * - running:对话进行中(2s 内有输出,与活动时间窗同阈值)
 * - unread:会话结束且未查看(完成未读)
 * - viewed:会话结束且已查看
 * - none:从未对话 —— 不亮灯、不出 label
 * 优先级:进行中压过未读(新输出即清未读,双保险)。
 */
export type SessionStatus = "running" | "unread" | "viewed" | "none";

export function resolveSessionStatus(
  lastActivityAt: number,
  unread: boolean,
  now: number,
): SessionStatus {
  if (lastActivityAt === 0) return "none";
  if (now - lastActivityAt < 2000) return "running";
  if (unread) return "unread";
  return "viewed";
}
