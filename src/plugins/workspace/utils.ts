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
