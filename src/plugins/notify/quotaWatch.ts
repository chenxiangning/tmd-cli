/**
 * 额度撞墙预警 ── 阈值判定纯函数 + 轮询节奏常量。
 * 判定:窗口「已用百分比」≥ 阈值即告警;按 (窗口标签, 重置时刻) 去重,
 * 同一窗口周期只报一次(重置后键变化自然解除)。余额型供应商无窗口,不参与。
 */

import type { QuotaWindow } from "@kernel/quota";

/** 首次抓取延迟(应用启动后 30s,让网络与凭据先就绪)。 */
export const QUOTA_POLL_FIRST_MS = 30_000;

/** 轮询间隔(10 分钟;额度 API 均有频控,不激进)。 */
export const QUOTA_POLL_INTERVAL_MS = 10 * 60_000;

/**
 * 从窗口列表挑出本次要告警的窗口;命中即记入 seen(跨轮询去重)。
 * 返回命中的窗口对象本身(消费方零二次查找);seen 由调用方持有。
 * 键含 25% 升级桶:无 resetsAt 的占比型快照(dsh 上下文构成)越过桶界可再报,
 * 不会「终生一次」然后在最该响的逼近段静默。
 */
export function pickQuotaWarnings(
  windows: readonly QuotaWindow[],
  usedPercentThreshold: number,
  seen: Set<string>,
): QuotaWindow[] {
  const fired: QuotaWindow[] = [];
  for (const w of windows) {
    if (w.displayPercent < usedPercentThreshold) continue;
    const bucket = Math.floor(w.displayPercent / 25);
    const key = `${w.label}:${w.resetsAt ?? 0}:${bucket}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fired.push(w);
  }
  return fired;
}
