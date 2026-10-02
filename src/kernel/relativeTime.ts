/**
 * 相对时间 + 短日期格式化 —— 全仓唯一实现(2026-09-29 四源收敛:mobile home 行 /
 * web-access 配对卡 / intent-canvas 卡片脚标原各持手写相对时间,均改引此处;
 * memory-coordinator / approval-inbox 的裸 toLocale* 日期同收敛到 formatDate/formatTime)。
 *
 * 相对时间单位词走 t() 三语词典(zh 即键,en/ja 词条在 locales/<lang>/time;
 * 「刚刚/{n} 分钟前」一族与 misc 既有词条同键复用);日期类按界面语言经
 * DATE_LOCALES 取 Intl tag,消费面不得自带 undefined/hardcode locale。
 */

import { t } from "./i18n";
import { getSettingsState } from "./settings";

/** 界面语言 → Intl locale tag(日期/时间格式化唯一同源映射)。 */
export const DATE_LOCALES: Record<string, string> = { zh: "zh-CN", en: "en-US", ja: "ja-JP" };

/** 当前界面语言的 Intl locale tag(未知语言兜底 zh-CN;intent-canvas 兜底档同源取用)。 */
export function currentLocaleTag(): string {
  return DATE_LOCALES[getSettingsState().settings.language] ?? "zh-CN";
}

/* 格式化器模块级缓存:界面语言只有 DATE_LOCALES 三种且 formatter 无状态,
   字面量表各建一次供热路径复用(react-doctor js-hoist-intl 只认模块级直接 new);
   locale 按调用时设置解析,语言切换整树重挂载后按新 tag 取表,行为不变。 */
const RESET_AT_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  "en-US": new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  "ja-JP": new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
};

const DATE_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }),
  "en-US": new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" }),
  "ja-JP": new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }),
};

const TIME_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  "en-US": new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }),
  "ja-JP": new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }),
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

/** ms epoch → 本地短日期("2026/9/28";先例:memory 面板/控制台列表行,收敛裸 toLocaleDateString)。 */
export function formatDate(ms: number): string {
  return DATE_FORMATTERS[currentLocaleTag()].format(new Date(ms));
}

/** ms epoch → 本地时刻("14:32";先例:approval-inbox 历史提问行,收敛裸 toLocaleTimeString)。 */
export function formatTime(ms: number): string {
  return TIME_FORMATTERS[currentLocaleTag()].format(new Date(ms));
}

/** 相对时间档位:上限秒数 → 单位(过去/未来向共用)。 */
const TIME_TIERS: ReadonlyArray<{ limit: number; unit: string }> = [
  { limit: 60, unit: "second" },
  { limit: 3600, unit: "minute" },
  { limit: 86_400, unit: "hour" },
  { limit: 604_800, unit: "day" },
  { limit: 604_800 * 5, unit: "week" },
  { limit: 86_400 * 360, unit: "month" },
  { limit: Infinity, unit: "year" },
];

/** 各单位换算到秒的除数。 */
const UNIT_DIVISORS: Record<string, number> = {
  second: 1, minute: 60, hour: 3600, day: 86_400,
  week: 604_800, month: 2_592_000, year: 31_536_000,
};

/** 中文单位名(zh 词典键成分:「{n} 分钟前/后」一族)。 */
const UNIT_LABELS: Record<string, string> = {
  second: "秒", minute: "分钟", hour: "小时", day: "天", week: "周", month: "个月", year: "年",
};

/**
 * 目标时刻相对现在的相对时间。
 * 过去 → "刚刚" / "N 分钟前" …;未来 → "现在" / "N 秒后" …。
 * targetMs 为 0/NaN 等空值时返回 "";nowMs 供测试/服务端对表注入,缺省本机时钟。
 */
export function formatRelativeTime(targetMs: number, nowMs: number = Date.now()): string {
  if (!targetMs) return "";
  const diffMs = targetMs - nowMs;
  const past = diffMs < 0;
  const sec = Math.floor(Math.abs(diffMs) / 1000);
  const tier = TIME_TIERS.find((u) => sec < u.limit) ?? TIME_TIERS[TIME_TIERS.length - 1];
  if (tier.unit === "second") {
    if (past) return t("刚刚");
    return sec === 0 ? t("现在") : t("{n} 秒后", { n: sec });
  }
  const value = Math.max(1, Math.floor(sec / UNIT_DIVISORS[tier.unit]));
  return t(`{n} ${UNIT_LABELS[tier.unit]}${past ? "前" : "后"}`, { n: value });
}
