/**
 * 列表卡片 footer 的相对时间 —— 相对段(<30 天)引 @kernel/relativeTime 全仓唯一
 * 实现(2026-09-29 四源收敛);kernel 无「今天 HH:mm / 昨天 / ≥30 天绝对日期」档,
 * 保留 canvas 本地兜底,日期/时刻格式化 locale 走 kernel 同源(DATE_LOCALES tag)。
 */
import { currentLocaleTag, formatRelativeTime, formatTime } from "@kernel/relativeTime";

type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/* M月D日(同年)/ 跨年带年份:canvas 特有档位,按 kernel 同源 tag 三语各建一次
   (react-doctor js-hoist-intl 只认模块级直接 new;语言切换整树重挂载后按新 tag 取表)。 */
const DATE_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }),
  "en-US": new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }),
  "ja-JP": new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }),
};

const DATE_CROSS_YEAR_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", year: "numeric" }),
  "en-US": new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }),
  "ja-JP": new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", year: "numeric" }),
};

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * 列表卡片 footer 的相对时间：今天 HH:mm / 昨天 / kernel 相对档(<30 天)/ M月D日（跨年带年份）。
 */
export function formatRelativeCanvasTime(
  updatedAt: string,
  now: Date,
  t: Translate,
): string {
  const updatedTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedTime)) {
    return updatedAt;
  }
  const updated = new Date(updatedTime);

  if (isSameLocalDay(updated, now)) {
    return t("今天 {time}", { time: formatTime(updatedTime) });
  }

  const yesterday = new Date(now.getTime() - DAY_MS);
  if (isSameLocalDay(updated, yesterday)) {
    return t("昨天");
  }

  /* 相对段引 kernel 唯一实现(分钟/小时/天/周档;7 天以上升周档,与桌面各列表同口径)。 */
  const days = Math.floor((now.getTime() - updatedTime) / DAY_MS);
  if (days < 30) {
    return formatRelativeTime(updatedTime, now.getTime());
  }

  const sameYear = updated.getFullYear() === now.getFullYear();
  const dateText = (sameYear ? DATE_FORMATTERS : DATE_CROSS_YEAR_FORMATTERS)[currentLocaleTag()].format(updated);
  return t("{date}", { date: dateText });
}
