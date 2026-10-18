/**
 * claude 限额窗口重置推算(纯函数)—— claude 无额度查询 API,窗口起点只能从
 * 本地会话 JSONL 的 usage 行时间戳推算(5h 滚动窗口口径公开)。codex/omp/pi
 * 等家族有真额度数据(cli-shared/quota/ 体系与凭据区),不在此列,返回 null;
 * 零网络,仅本地时间运算。welcome/tokens 聚合消费。
 */

import type { UsageLine } from "../cli-shared/sessionUsage";

/** claude 官方 5h 滚动限额窗口。 */
export const QUOTA_WINDOW_MS = 5 * 3600_000;

/** 推算结果:窗口起点(该窗口内最早一条用量行)与重置时刻。 */
export interface QuotaWindow {
  windowStartMs: number;
  resetAtMs: number;
}

/**
 * claude 的当前 5h 窗口推算。取行中最大 ts 为 L,回溯收集 ts > L-5h 的事件,
 * 最早 ts 即 windowStart,resetAt = windowStart + 5h。
 * lines 空 / 推算出的窗口已滚走(resetAt <= now)/ 家族非 claude → null。
 */
export function windowResetFor(
  family: string,
  lines: readonly UsageLine[],
  now: number,
): QuotaWindow | null {
  if (family !== "claude" || lines.length === 0) return null;
  /* 未来行(他设备时钟超前/本机回拨)整体剔除:留它当窗口锚会把倒计时拉飞 skew+5h */
  const fresh = lines.filter((l) => l.ts <= now);
  if (fresh.length === 0) return null;
  let latest = -Infinity;
  for (const l of fresh) if (l.ts > latest) latest = l.ts;
  let start = Infinity;
  for (const l of fresh) {
    if (l.ts > latest - QUOTA_WINDOW_MS && l.ts < start) start = l.ts;
  }
  if (!Number.isFinite(start)) return null;
  const resetAtMs = start + QUOTA_WINDOW_MS;
  /* 窗口已滚走(启发式锚点过期):与「无数据」同口径,UI 显 —,不显冻结值。 */
  if (resetAtMs <= now) return null;
  return { windowStartMs: start, resetAtMs };
}
