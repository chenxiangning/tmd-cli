/**
 * 额度撞墙预警 ── 阈值判定纯函数 + 轮询节奏常量。
 * 判定(三腿,均按 key 去重,同键只报一次):
 * - 窗口腿:窗口「已用百分比」≥ 阈值(pickQuotaWarnings);
 * - 余额腿:余额数值 < 绝对下限(pickBalanceWarning,仅 deepseek/relay 有数值);
 * - claude 窗口腿:本地推算的 5h 窗口距重置不足 N 分钟(pickResetWarning)。
 * seen 集合由调用方持有(生产 = notify-log.json 头部 quotaSeen 持久化,重启不失忆)。
 */

import type { QuotaWindow } from "@kernel/quota";
import type { SessionMeta } from "@kernel/ipc";

/** 首次抓取延迟(应用启动后 30s,让网络与凭据先就绪)。 */
export const QUOTA_POLL_FIRST_MS = 30_000;

/** 轮询间隔(10 分钟;额度 API 均有频控,不激进)。 */
export const QUOTA_POLL_INTERVAL_MS = 10 * 60_000;

/** 额度监控会话集合:运行中会话 ∪ 平铺幕布(kept 序),按 id 去重保序
 *  (运行中在前 —— 同供应商取到的抓取参数偏向真在跑的会话)。
 *  供应商级去重由消费侧按 profileId 归并;kept 里的死 id 找不到会话即忽略。 */
export function watchedQuotaSessions(
  sessions: readonly SessionMeta[],
  keptIds: readonly string[],
): SessionMeta[] {
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const out: SessionMeta[] = [];
  const seen = new Set<string>();
  for (const s of [...sessions, ...keptIds.flatMap((id) => byId.get(id) ?? [])]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** 窗口腿去重键(引擎前缀 + 标签 + 重置时刻 + 升级桶);持久化与判定共用同一公式。 */
export function quotaWindowKey(w: QuotaWindow, keyPrefix = ""): string {
  const bucket = w.resetsAt == null ? Math.floor(w.displayPercent / 25) : 0;
  return `${keyPrefix}${w.label}:${w.resetsAt ?? 0}:${bucket}`;
}

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
  keyPrefix = "",
): QuotaWindow[] {
  const fired: QuotaWindow[] = [];
  for (const w of windows) {
    if (w.displayPercent < usedPercentThreshold) continue;
    /* 桶升级只对无 resetsAt 的占比型快照(dsh 上下文构成)生效:有重置时刻的
     * 窗口同一周期只报一次;无重置快照越 25% 桶界可再报,不会「终生一次」
     * 在最该响的逼近段静默。 */
    const key = quotaWindowKey(w, keyPrefix);
    if (seen.has(key)) continue;
    seen.add(key);
    fired.push(w);
  }
  return fired;
}

/**
 * 余额腿:balanceValue 存在且 < below(绝对阈值,货币跟随回包)即告警一次。
 * below <= 0 = 关(调用方已短路,这里再守一道);balanceValue undefined(非
 * deepseek/relay 或无数值)不参与。键由调用方给「引擎前缀 + 越线小时桶」。
 */
export function pickBalanceWarning(
  balanceValue: number | undefined,
  below: number,
  key: string,
  seen: Set<string>,
): boolean {
  if (below <= 0 || balanceValue === undefined || balanceValue >= below) return false;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/**
 * claude 窗口腿:resetAtMs - now < minutesBefore*60s 即告警(「N 分后重置」)。
 * resetAtMs null(无推算/窗口已滚走)不参与;键由调用方给「引擎前缀 + resetAt」
 * (resetAt 天然按周期翻新,重置后同键不再命中)。
 */
export function pickResetWarning(
  resetAtMs: number | null,
  now: number,
  minutesBefore: number,
  key: string,
  seen: Set<string>,
): boolean {
  if (resetAtMs === null || minutesBefore <= 0) return false;
  if (resetAtMs - now >= minutesBefore * 60_000) return false;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
