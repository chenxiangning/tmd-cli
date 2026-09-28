type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/* Intl formatter 模块级复用(new 的解析成本在卡片时间热路径上)。 */
const CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" });
const DATE_CROSS_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", year: "numeric" });

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * 列表卡片 footer 的相对时间：今天 HH:mm / 昨天 / N 天前（<30 天）/ M月D日（跨年带年份）。
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
    return t("今天 {time}", { time: CLOCK_FORMATTER.format(updated) });
  }

  const yesterday = new Date(now.getTime() - DAY_MS);
  if (isSameLocalDay(updated, yesterday)) {
    return t("昨天");
  }

  const days = Math.floor((now.getTime() - updatedTime) / DAY_MS);
  if (days < 30) {
    return t("{count} 天前", { count: days });
  }

  const sameYear = updated.getFullYear() === now.getFullYear();
  const dateText = (sameYear ? DATE_FORMATTER : DATE_CROSS_YEAR_FORMATTER).format(updated);
  return t("{date}", { date: dateText });
}
