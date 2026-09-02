/**
 * 相对时间 —— 过去向与未来向收敛为一份实现。
 * 此前 workspace 侧(过去向:"刚刚"/"N 分")与 composer QuotaChip 侧
 * (未来向:"N秒后"/"现在")各写一份,此处统一为带语向的单一函数。
 *
 * formatResetAt: 额度窗口重置时刻的短绝对格式("9月5日 14:30"),
 * QuotaChip 弹窗与 welcome 额度区共用,禁止各自再写一份。
 */

/** ms epoch → "9月5日 14:30"(额度窗口下次重置时间)。 */
export function formatResetAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 目标时刻相对现在的中文相对时间。
 * 过去 → "刚刚" / "N 分钟前" / "N 小时前" / "N 天前" / "N 周前" / "N 个月前";
 * 未来 → "现在" / "N 秒后" / "N 分钟后" / "N 小时后" / "N 天后" / "N 周后" / "N 个月后"。
 * targetMs 为 0/NaN 等空值时返回 ""。
 */
export function formatRelativeTime(targetMs: number): string {
  if (!targetMs) return "";
  const diffMs = targetMs - Date.now();
  const past = diffMs < 0;
  const sec = Math.floor(Math.abs(diffMs) / 1000);
  if (sec < 60) return past ? "刚刚" : sec === 0 ? "现在" : `${sec} 秒后`;
  const suffix = past ? "前" : "后";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟${suffix}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时${suffix}`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天${suffix}`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week} 周${suffix}`;
  return `${Math.floor(day / 30)} 个月${suffix}`;
}
