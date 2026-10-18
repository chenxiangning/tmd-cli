/**
 * 免打扰窗(DND)── 纯判定函数,设置读取归各消费闸。
 *
 * 三闸共用(notify/logic.ts shouldNotify、kernel/askSound、kernel/turnSound):
 * 免打扰只静 OS 通知与应用内提示音,通知中心流水照常记录。
 * 窗口语义:HH:mm 起止,支持跨夜(22:00-08:00);start === end 视为全天静默;
 * 起点含、终点不含(08:00 整解除)。
 */

/** 免打扰设置子面(与 kernel/settingsTypes 键名对齐;调用方传 AppSettings 即可)。 */
export interface DndPrefs {
  notifyDndEnabled: boolean;
  notifyDndStart: string;
  notifyDndEnd: string;
}

/** "HH:mm" → 当日分钟数;格式非法返回 null(调用方按不静默处理)。 */
export function parseHhMm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** now 时刻的 "HH:mm"(本地时区)。 */
export function hhMmOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getHours())}:${p(now.getMinutes())}`;
}

/**
 * now(HH:mm)是否落在 [start, end) 静默窗内。
 * 任一时刻串非法 → false(宁可响,不静默);start === end → 全天静默。
 */
export function inDndWindow(now: string, start: string, end: string): boolean {
  const n = parseHhMm(now);
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (n === null || s === null || e === null) return false;
  if (s === e) return true;
  if (s < e) return n >= s && n < e; /* 同日窗 */
  return n >= s || n < e; /* 跨夜窗 */
}

/** 三闸共用判定:开关关 → 不静默;开则按窗口判(默认取当前时刻)。 */
export function isDndActive(prefs: DndPrefs, now: Date = new Date()): boolean {
  if (!prefs.notifyDndEnabled) return false;
  return inDndWindow(hhMmOf(now), prefs.notifyDndStart, prefs.notifyDndEnd);
}
