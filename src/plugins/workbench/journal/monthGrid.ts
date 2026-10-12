/**
 * 月视图纯函数(自 MonthCells/MonthView 拆出,守 only-export-components):
 * 无 JSX、无状态,月格样式类与月统计共用一处。
 */
import { pad2 } from "./journalFiles";
import type { DaySessionRow } from "./daySessions";
import type { MonthSnapshot } from "./journalStore";

/** 格 className(纯函数:今日/周末;热力与状态色改由正文 pill 承载,格底保持白净)。 */
export function cellClass(isToday: boolean, we: boolean): string {
  return ["dj-cell", isToday && "dj-today", we && "dj-we"].filter(Boolean).join(" ");
}

/** 月统计(纯函数:有记录天数/会话总数/文章数/待生成数/今日活会话)。
 *  与月视图格子同源(A5):按日历日遍历,「有记录」= 会话行∨文章∨便签;
 *  pending 与「补齐待生成」(fillPendingDays)同口径,增量并入日由格子按钮承接。 */
export function monthStats(
  sessions: Map<string, DaySessionRow[]> | null,
  snap: MonthSnapshot | undefined,
  ym: { y: number; m: number },
  today: string,
): { days: number; sessTotal: number; artTotal: number; pending: number; todayLive: number } {
  if (!sessions) return { days: 0, sessTotal: 0, artTotal: 0, pending: 0, todayLive: 0 };
  const prefix = `${ym.y}-${pad2(ym.m)}`;
  const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
  const acc = { days: 0, sessTotal: 0, artTotal: 0, pending: 0, todayLive: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${prefix}-${pad2(d)}`;
    const rows = sessions.get(key) ?? [];
    const hasArticle = !!snap?.articles[pad2(d)];
    if (rows.length > 0 || hasArticle || snap?.notes[pad2(d)]) acc.days++;
    acc.sessTotal += rows.length;
    if (hasArticle) acc.artTotal++;
    if (rows.length > 0 && !hasArticle) acc.pending++;
    if (key === today) acc.todayLive = rows.filter((r) => r.live).length;
  }
  return acc;
}
