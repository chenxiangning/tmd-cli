/**
 * 本地化日期文案(设置语言驱动;session-board boardData 同款公式,插件私有复写)。
 */
import { getSettingsState } from "@kernel/settings";

const ZH_WD = ["日", "一", "二", "三", "四", "五", "六"];
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(language: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${language}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(language, opts)));
  return f;
}

/** 周首行(周一开头):一二三四五六日 / Mon..Sun。 */
export function weekdayLabelsMon(): string[] {
  const { language } = getSettingsState().settings;
  if (language === "zh") return ["一", "二", "三", "四", "五", "六", "日"];
  const f = fmt(language, { weekday: "short" });
  /* 2024-01-01 是周一。 */
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i)));
}

/** 日标题(如「9 月 16 日 周三」/ locale 短格式)。 */
export function dayTitleOf(y: number, m: number, d: number): string {
  const { language } = getSettingsState().settings;
  const date = new Date(y, m - 1, d);
  if (language === "zh") return `${m} 月 ${d} 日 周${ZH_WD[date.getDay()]}`;
  return fmt(language, { month: "short", day: "numeric", weekday: "short" }).format(date);
}

/** 迷你月头短月名(zh「9月」/ en「Sep」)。 */
export function monthShortOf(m: number): string {
  const { language } = getSettingsState().settings;
  return fmt(language, { month: "short" }).format(new Date(2024, m - 1, 1));
}

/** 月标题(如「2026 年 9 月」)。 */
export function monthTitleOf(y: number, m: number): string {
  const { language } = getSettingsState().settings;
  if (language === "zh") return `${y} 年 ${m} 月`;
  return fmt(language, { year: "numeric", month: "long" }).format(new Date(y, m - 1, 1));
}
