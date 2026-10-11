/**
 * 工作台 · 日历与时间线模型(移植自 projectHub shared/insights.js 的两节)。
 * 日历:6 周网格,每格列出当天到期的项目与未完成任务;时间线:甘特式横条,
 * 跨度按项目起止自动取,补齐到周,最长 210 天。
 */

import { dayStart, openTasks, projectRisk, todayISO, daysLeft, type RiskInfo, type RiskTone } from "./analysis";
import type { Project } from "./types";

const pad = (value: number): string => String(value).padStart(2, "0");
const DAY_MS = 24 * 60 * 60 * 1000;

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
          key: `${project.id}::due`, kind: "due", tone: risk.tone, label: risk.label,
          title: project.name, projectId: project.id, module: project.module || "其他项目",
        });
      }
      for (const task of openTasks(project)) {
        if (task.dueDate !== iso) continue;
        const overdue = (daysLeft(iso, today) ?? 1) < 0;
        items.push({
          key: `${project.id}::${task.id}`, kind: "task", taskId: task.id,
          tone: overdue ? "danger" : "muted", label: "任务", title: task.title,
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

export interface TimelineRow {
  project: Project;
  risk: RiskInfo;
  startIso: string;
  endIso: string;
  leftPercent: number;
  widthPercent: number;
}

export interface TimelineModel {
  from: string;
  to: string;
  totalDays: number;
  ticks: Array<{ index: number; percent: number; label: string }>;
  rows: TimelineRow[];
  todayPercent: number;
  padded: boolean;
}

/** 时间线(甘特)模型:横轴是日期,每行一个项目;跨度补齐到周,最长 210 天。 */
export function timelineModel(projects: readonly Project[], today: string = todayISO()): TimelineModel {
  if (projects.length === 0) {
    return { from: today, to: today, totalDays: 0, ticks: [], rows: [], todayPercent: 0, padded: false };
  }
  const now = dayStart(today)!;
  const points = [now];
  for (const project of projects) {
    points.push(dayStart(project?.startedOn) ?? now, dayStart(project?.dueDate) ?? now);
  }
  const rawFrom = Math.min(...points);
  const rawTo = Math.max(...points);
  const fromDate = new Date(Math.min(rawFrom, now - 3 * DAY_MS));
  fromDate.setDate(fromDate.getDate() - fromDate.getDay());
  const toDate = new Date(Math.max(rawTo, now + 3 * DAY_MS));
  toDate.setDate(toDate.getDate() + (6 - toDate.getDay()));
  let span = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  let padded = false;
  if (span > 210) {
    padded = true;
    toDate.setTime(fromDate.getTime() + 209 * DAY_MS);
    span = 210;
  }
  const totalDays = span;
  const offsetOf = (millis: number) => Math.max(0, Math.min(totalDays, (millis - fromDate.getTime()) / DAY_MS));
  const percent = (value: number) => (totalDays === 0 ? 0 : (value / totalDays) * 100);
  const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const ticks = [];
  for (let index = 0; index < totalDays; index += 7) {
    const date = new Date(fromDate.getTime() + index * DAY_MS);
    ticks.push({ index, percent: percent(index), label: `${date.getMonth() + 1}/${date.getDate()}` });
  }

  const rows = [...projects]
    .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))
    .map((project) => {
      const startMillis = dayStart(project?.startedOn) ?? now;
      const dueMillis = dayStart(project?.dueDate) ?? now;
      const left = offsetOf(Math.min(startMillis, dueMillis));
      const right = offsetOf(Math.max(startMillis, dueMillis)) + 1;
      return {
        project,
        risk: projectRisk(project, today),
        startIso: isoOf(new Date(Math.min(startMillis, dueMillis))),
        endIso: isoOf(new Date(Math.max(startMillis, dueMillis))),
        leftPercent: percent(left),
        widthPercent: percent(Math.max(1, right - left)),
      };
    });
  return { from: isoOf(fromDate), to: isoOf(toDate), totalDays, ticks, rows, todayPercent: percent(offsetOf(now)), padded };
}
