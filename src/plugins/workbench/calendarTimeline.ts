/**
 * 工作台 · 日历模型(移植自 projectHub shared/insights.js):6 周网格,
 * 每格列出当天到期的项目与未完成任务;消费方 = 工作日志月视图。
 * (2026-10-12 三撤一合:甘特 timelineModel 随时间线页签退役 orphan。)
 */

import { t } from "@kernel/i18n";
import { openTasks, projectRisk, todayISO, daysLeft, type RiskTone } from "./analysis";
import { RISK_LABELS } from "./insights";
import type { Project } from "./types";

const pad = (value: number): string => String(value).padStart(2, "0");

export const monthKeyOf = (today: string = todayISO()): string => String(today).slice(0, 7);

/** 月份加减,返回 YYYY-MM。 */
export function shiftMonth(key: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key));
  if (!match) return monthKeyOf();
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key));
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : String(key);
}

export interface CalendarItem {
  key: string;
  kind: "due" | "task";
  taskId?: string;
  tone: RiskTone | "muted";
  label: string;
  title: string;
  projectId: string;
  projectName?: string;
  module: string;
}

export interface CalendarCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  items: CalendarItem[];
}

export interface CalendarMonthModel {
  key: string;
  label: string;
  weeks: CalendarCell[][];
  cells: CalendarCell[];
  monthItems: number;
  daysWithItems: number;
}

/** 一个月的日历模型:6 周网格,每格列出当天到期的项目与未完成任务。 */
export function calendarMonth(
  projects: readonly Project[],
  today: string = todayISO(),
  key: string = monthKeyOf(today),
): CalendarMonthModel {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key));
  const year = match ? Number(match[1]) : Number(today.slice(0, 4));
  const month = match ? Number(match[2]) : Number(today.slice(5, 7));
  const first = new Date(year, month - 1, 1);
  const lead = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells: CalendarCell[] = [];
  let monthItems = 0;
  for (let index = 0; index < total; index += 1) {
    const date = new Date(year, month - 1, index - lead + 1);
    const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const items: CalendarItem[] = [];
    for (const project of projects) {
      if (project?.dueDate === iso) {
        const risk = projectRisk(project, today);
        items.push({
          key: `${project.id}::due`, kind: "due", tone: risk.tone, label: t(RISK_LABELS[risk.level]),
          title: project.name, projectId: project.id, module: project.module || "其他项目",
        });
      }
      for (const task of openTasks(project)) {
        if (task.dueDate !== iso) continue;
        const overdue = (daysLeft(iso, today) ?? 1) < 0;
        items.push({
          key: `${project.id}::${task.id}`, kind: "task", taskId: task.id,
          tone: overdue ? "danger" : "muted", label: t("任务"), title: task.title,
          projectId: project.id, projectName: project.name, module: project.module || "其他项目",
        });
      }
    }
    items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "due" ? -1 : 1));
    const inMonth = index - lead + 1 >= 1 && index - lead + 1 <= daysInMonth;
    if (inMonth) monthItems += items.length;
    cells.push({
      iso, day: date.getDate(), inMonth,
      isToday: iso === today,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      items,
    });
  }

  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  const daysWithItems = cells.filter((cell) => cell.inMonth && cell.items.length > 0).length;
  return { key, label: monthLabel(key), weeks, cells, monthItems, daysWithItems };
}

