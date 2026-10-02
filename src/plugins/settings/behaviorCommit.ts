/**
 * 行为卡数字输入提交纯模型(BehaviorTab 消费,抽出为可单测纯函数)。
 * 会话输出缓冲上限合法域 50_000–10_000_000,与 kernel/settingsSanitize 的
 * sanitizeBufferLimit 同域:域外钳制到最近边界;空/非数字回落 store 当前值。
 */

export const BUFFER_LIMIT_MIN = 50_000;
export const BUFFER_LIMIT_MAX = 10_000_000;

/** 提交值计算:parseInt 取整;域外钳到最近边界,非法回落 current(store 当前值)。 */
export function sanitizeBufferLimitInput(raw: string, current: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return current;
  return Math.min(BUFFER_LIMIT_MAX, Math.max(BUFFER_LIMIT_MIN, n));
}
