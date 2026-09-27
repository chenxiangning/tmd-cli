/**
 * 等待确认起始时刻追踪(看板「等待确认」分区时长显示用,spec 2026-09-27)。
 * askDetected 边沿覆写记时(边沿每次升级恰一发,重绘不重触发);turnSettled /
 * 会话退出清除。边沿缺失场景(应用启动时已在等待)无记录 → 显示「等待中」
 * 不假起走(approval-inbox observeCurrentWaitings 同款「宁缺不假」纪律)。
 */

const sinceAt = new Map<string, number>();

/** askDetected 边沿:覆写记时,新提问重置(防上一轮残留算出超长时长)。 */
export function noteWaitingAsk(sessionId: string): void {
  sinceAt.set(sessionId, Date.now());
}

/** 轮次结算:清该会话时刻(等待位在作答时已由内核清,此为兜底收账)。 */
export function noteTurnSettled(sessionId: string): void {
  sinceAt.delete(sessionId);
}

/** 会话退出:清账防泄漏。 */
export function noteSessionExited(sessionId: string): void {
  sinceAt.delete(sessionId);
}

/** 等待起始时刻;无边沿记录(启动已在等)返回 null。 */
export function waitingSinceOf(sessionId: string): number | null {
  return sinceAt.get(sessionId) ?? null;
}

/** 测试专用:清空模块级状态(vitest 复用同一模块实例)。 */
export function resetWaitingSinceForTest(): void {
  sinceAt.clear();
}
