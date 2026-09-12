/**
 * 相对时间 —— 过去向与未来向收敛为一份实现,i18n 后按界面语言格式化
 * (zh 保持原口径;en/ja 走 Intl.RelativeTimeFormat,原生平台能力零手写词典)。
 *
 * formatResetAt: 额度窗口重置时刻的短绝对格式("9月5日 14:30"),
 * QuotaChip 弹窗与 welcome 额度区共用,禁止各自再写一份。
 */

import { getSettingsState } from "./settings";

const DATE_LOCALES: Record<string, string> = { zh: "zh-CN", en: "en-US", ja: "ja-JP" };

function currentLocaleTag(): string {
  return DATE_LOCALES[getSettingsState().settings.language] ?? "zh-CN";
}

/* 格式化器模块级缓存:界面语言只有 DATE_LOCALES 三种且 formatter 无状态,
   字面量表各建一次供热路径复用(react-doctor js-hoist-intl 只认模块级直接 new);
   locale 仍按调用时设置解析,行为不变。 */
const RESET_AT_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  "en-US": new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  "ja-JP": new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
};

const RELATIVE_FORMATTERS: Record<string, Intl.RelativeTimeFormat> = {
  "zh-CN": new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }),
  "en-US": new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }),
  "ja-JP": new Intl.RelativeTimeFormat("ja-JP", { numeric: "auto" }),
};

/** ms epoch → "9月5日 14:30" / "Sep 5, 2:30 PM"(额度窗口下次重置时间)。 */
export function formatResetAt(ms: number): string {
  return RESET_AT_FORMATTERS[currentLocaleTag()].format(new Date(ms));
}

/** ms epoch → "2026-09-03 14:32:05"(账本/审计场景的精确时刻,秒级、可排序,语言无关)。 */
export function formatAbsolute(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 相对时间文案表:zh 手写(历史口径),其余语言交给 Intl.RelativeTimeFormat。 */
const ZH_UNITS: ReadonlyArray<{ limit: number; unit: string }> = [
  { limit: 60, unit: "second" },
  { limit: 3600, unit: "minute" },
  { limit: 86_400, unit: "hour" },
  { limit: 604_800, unit: "day" },
  { limit: 604_800 * 5, unit: "week" },
  { limit: 86_400 * 360, unit: "month" },
  { limit: Infinity, unit: "year" },
];

/** Intl 单位名与中文单位名。 */
const UNIT_LABELS: Record<string, string> = {
  second: "秒", minute: "分钟", hour: "小时", day: "天", week: "周", month: "个月", year: "年",
};

/**
 * 目标时刻相对现在的相对时间。
 * 过去 → "刚刚" / "N 分钟前" …;未来 → "现在" / "N 秒后" …。
 * targetMs 为 0/NaN 等空值时返回 ""。
 */
export function formatRelativeTime(targetMs: number): string {
  if (!targetMs) return "";
  const diffMs = targetMs - Date.now();
  const past = diffMs < 0;
  const sec = Math.floor(Math.abs(diffMs) / 1000);
  const language = getSettingsState().settings.language;
  const unit = ZH_UNITS.find((u) => sec < u.limit) ?? ZH_UNITS[ZH_UNITS.length - 1];
  const value = Math.max(1, Math.floor(sec / UNIT_DIVISORS[unit.unit]));
  if (language === "zh") {
    if (unit.unit === "second") return past ? "刚刚" : sec === 0 ? "现在" : `${sec} 秒后`;
    return `${value} ${UNIT_LABELS[unit.unit]}${past ? "前" : "后"}`;
  }
  return RELATIVE_FORMATTERS[currentLocaleTag()].format(
    past ? -value : value,
    unit.unit as Intl.RelativeTimeFormatUnit,
  );
}

/** 各单位换算到秒的除数。 */
const UNIT_DIVISORS: Record<string, number> = {
  second: 1, minute: 60, hour: 3600, day: 86_400,
  week: 604_800, month: 2_592_000, year: 31_536_000,
};
