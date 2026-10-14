/**
 * 工作台 · 聚焦页数据模型(纯函数;自 FocusScreen 拆出守 only-export-components)。
 * 三段数据:要处理(复用 followUpBuckets,前三桶展开 + 更晚/未排期折叠)、
 * 接下来 14 天(项目 DDL chip + 当日到期任务密度,不堆任务卡)、
 * 项目脉搏(被跟踪项目活动流行 + 空壳沉底折叠)。
 * 设计:docs/superpowers/specs/2026-10-12-workbench-focus-view-design.md
 */

import { daysBetween, dayStart, openTasks, projectRisk, todayISO, type RiskLevel, type RiskTone } from "./analysis";
import { followUpBuckets, type FollowUpBucket, type FollowUpItem } from "./followUpBuckets";
import { collectLinkedSessions } from "./views";
import type { Project } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 要处理展开桶(更晚/未排期折叠为一行,不是现在的事不占首屏)。 */
export const FOCUS_MAIN_KEYS = ["overdue", "today", "week"] as const;

export interface FocusBuckets {
  /** 已逾期/今天到期/本周内,顺序固定。 */
  main: FollowUpBucket[];
  /** 更晚 + 未排期合并(到期日升序,未排期沉底)。 */
  later: FollowUpItem[];
}

export function focusBuckets(projects: readonly Project[], today: string = todayISO()): FocusBuckets {
  const buckets = followUpBuckets(projects, today);
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  return {
    main: FOCUS_MAIN_KEYS.map((key) => byKey.get(key)!),
    later: [...(byKey.get("later")?.items ?? []), ...(byKey.get("none")?.items ?? [])],
  };
}

export interface BandDdl {
  projectId: string;
  name: string;
  tone: RiskTone;
}

export interface BandDay {
  /** 本地日历日 YYYY-MM-DD。 */
  iso: string;
  date: Date;
  isToday: boolean;
  isWeekend: boolean;
  /** 当日截止的项目(风险着色)。 */
  ddls: BandDdl[];
  /** 当日到期的未完成任务(带内只出计数徽标,明细走悬停)。 */
  tasks: FollowUpItem[];
}

/** 接下来 N 天水平带:只表达到期密度(DDL + 任务数),空日零占位。 */
export function focusBand(projects: readonly Project[], today: string = todayISO(), days = 14): BandDay[] {
  const base = dayStart(today) ?? Date.now();
  const open: FollowUpItem[] = [];
  for (const bucket of followUpBuckets(projects, today)) open.push(...bucket.items);
  const result: BandDay[] = [];
  /* 固定 +24h 步进在 DST 切换日会偏 ±1 小时,但这里只取 Date 的本地年月日/星期
   * (iso 拼接与 isWeekend),日历日不漂移;不做逐日进位是有意取舍,国内无感。 */
  for (let i = 0; i < days; i++) {
    const date = new Date(base + i * DAY_MS);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    result.push({
      iso,
      date,
      isToday: i === 0,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      ddls: projects
        .filter((project) => project.dueDate === iso)
        .map((project) => ({ projectId: project.id, name: project.name, tone: projectRisk(project, today).tone })),
      tasks: open.filter((item) => item.dueDate === iso),
    });
  }
  return result;
}

export type ActivityKind = "session" | "doc" | "update";

export interface ProjectActivity {
  kind: ActivityKind;
  /** ISO 时间戳。 */
  at: string;
  text: string;
}

/** 最近活动:会话/文档/进展三源取最新(自动可得数据优先,手工字段退弱)。 */
export function latestActivity(project: Project): ProjectActivity | null {
  const candidates: ProjectActivity[] = [];
  const update = project.updates.reduce<ProjectActivity | null>(
    (best, item) => (best && best.at >= item.at ? best : { kind: "update", at: item.at, text: item.text }),
    null,
  );
  if (update) candidates.push(update);
  const doc = project.docs.reduce<ProjectActivity | null>(
    (best, item) => (best && best.at >= item.updatedAt ? best : { kind: "doc", at: item.updatedAt, text: item.title }),
    null,
  );
  if (doc) candidates.push(doc);
  /* collectLinkedSessions 已按关联时刻倒序,首条即最新。 */
  const session = collectLinkedSessions(project.tasks)[0];
  if (session) candidates.push({ kind: "session", at: session.createdAt, text: session.title || session.ref });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, item) => (Date.parse(item.at) > Date.parse(best.at) ? item : best));
}

export interface PulseRow {
  project: Project;
  open: number;
  tone: RiskTone;
  riskLevel: RiskLevel;
  activity: ProjectActivity | null;
}

export interface PulsePartition {
  /** 被跟踪项目(有未完成任务/有 DDL/有活动),按风险排序。 */
  rows: PulseRow[];
  /** 空壳项目(三样全无),字母序,默认折叠沉底。 */
  ghosts: Project[];
}

/** 被跟踪 / 空壳划分:被跟踪 = 有未完成任务/有 DDL/近 7 天有活动;
 *  空壳不驱逐,折叠成可检索索引。行序按最近活动倒序(无活动沉底)。 */
export function pulsePartition(projects: readonly Project[], today: string = todayISO()): PulsePartition {
  const activities = new Map<string, ProjectActivity | null>();
  const tracked: Project[] = [];
  const ghosts: Project[] = [];
  for (const project of projects) {
    const activity = latestActivity(project);
    activities.set(project.id, activity);
    const fresh = activity !== null && (activityAge(activity.at, today) ?? 99) <= 7;
    if (openTasks(project).length > 0 || project.dueDate || fresh) tracked.push(project);
    else ghosts.push(project);
  }
  const rows = tracked
    .map((project) => {
      const risk = projectRisk(project, today);
      return { project, open: openTasks(project).length, tone: risk.tone, riskLevel: risk.level, activity: activities.get(project.id) ?? null };
    })
    .sort((a, b) => Date.parse(b.activity?.at ?? "0") - Date.parse(a.activity?.at ?? "0") || a.project.name.localeCompare(b.project.name, "zh"));
  ghosts.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return { rows, ghosts };
}

export interface FocusLine {
  overdue: number;
  dueToday: number;
  /** 被跟踪项目数(活跃口径)。 */
  active: number;
  /** 逾期与今天到期双全无。 */
  calm: boolean;
  /** 清净态「最近活跃在 X」的项目名(无活动则 undefined)。 */
  topName?: string;
}

/** 聚焦页结论行(行动口径;概览 headline 同样按被跟踪集计账,A2 后两处同口径)。 */
export function focusLine(buckets: FocusBuckets, pulse: PulsePartition): FocusLine {
  const overdue = buckets.main[0]?.total ?? 0;
  const dueToday = buckets.main[1]?.total ?? 0;
  const top = pulse.rows
    .filter((row) => row.activity !== null)
    .sort((a, b) => Date.parse(b.activity!.at) - Date.parse(a.activity!.at))[0];
  return {
    overdue,
    dueToday,
    active: pulse.rows.length,
    calm: overdue === 0 && dueToday === 0,
    topName: top?.project.name,
  };
}

/** 活动时刻相对今天的天数差(本地日历日口径;不可解析 → null)。 */
export function activityAge(at: string, today: string): number | null {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return daysBetween(iso, today);
}
