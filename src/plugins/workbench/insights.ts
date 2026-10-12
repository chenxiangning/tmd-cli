/**
 * 工作台 · 看板数据层:KPI、风险分布、模块负载、进度分布、负责人负载、
 * 一句话结论。移植自 projectHub shared/insights.js(日历/时间线/待跟进分桶拆至
 * calendarTimeline.ts / followUpBuckets.ts,守 300 行铁则)。
 */

import { t } from "@kernel/i18n";

import {
  DANGER_LEVELS, RISK_LEVELS, RISK_META, WATCH_LEVELS, clampProgress, daysLeft, endOfWeek,
  moduleNames, openTasks, projectRisk, sortByRisk, todayISO,
  type RiskLevel, type RiskTone,
} from "./analysis";
import type { Project, ProjectTask } from "./types";
import { summarize } from "./views";

export const MODULE_ACCENTS = ["indigo", "teal", "amber", "violet", "rose", "cyan"] as const;
export type ModuleAccent = (typeof MODULE_ACCENTS)[number];

/** 每个模块一个固定强调色(顺序稳定,刷新不会变色)。 */
export function moduleAccentMap(projects: readonly Project[]): Record<string, ModuleAccent> {
  const map: Record<string, ModuleAccent> = {};
  moduleNames(projects).forEach((name, index) => {
    map[name] = MODULE_ACCENTS[index % MODULE_ACCENTS.length];
  });
  return map;
}

export interface Kpis {
  total: number; active: number; done: number; avgProgress: number;
  openTasks: number; doneTasks: number; completion: number; taskOverdue: number; weekDue: number;
  attention: number; danger: number; watch: number; overdue: number; blocked: number;
  urgent: number; slipping: number; soon: number; normal: number; unscheduled: number;
}

/** 顶部 KPI 需要的全部数字,一次算完。 */
export function kpis(projects: readonly Project[], today: string = todayISO()): Kpis {
  const stats = summarize(projects, today);
  const risks = projects.map((project) => projectRisk(project, today));
  const count = (level: RiskLevel) => risks.filter((risk) => risk.level === level).length;
  const open = projects.reduce((sum, project) => sum + openTasks(project).length, 0);
  const doneTasks = projects.reduce((sum, project) => sum + project.tasks.filter((task) => task.status === "done").length, 0);
  const taskOverdue = projects.reduce(
    (sum, project) => sum + openTasks(project).filter((task) => (task.dueDate ? daysLeft(task.dueDate, today) ?? 1 : 1) < 0).length,
    0,
  );
  const weekDue = projects.filter((project) => {
    const left = daysLeft(project.dueDate, today);
    return left !== null && left >= 0 && (project.dueDate ?? "") <= endOfWeek(today);
  }).length;
  return {
    total: stats.total, active: stats.active, done: stats.done, avgProgress: stats.avgProgress,
    openTasks: open, doneTasks,
    completion: open + doneTasks === 0 ? 0 : Math.round((doneTasks / (open + doneTasks)) * 100),
    taskOverdue, weekDue,
    attention: stats.danger + stats.watch, danger: stats.danger, watch: stats.watch,
    overdue: count("overdue"), blocked: count("blocked"), urgent: count("urgent"),
    slipping: count("slipping"), soon: count("soon"), normal: count("normal"), unscheduled: count("unscheduled"),
  };
}

export interface RiskSlice {
  level: RiskLevel; count: number; label: string; tone: RiskTone; rank: number; percent: number;
}

/** 风险分布(环形图用),按风险从高到低,只保留有数量的等级。 */
export function riskBreakdown(projects: readonly Project[], today: string = todayISO()): RiskSlice[] {
  const total = projects.length;
  const counts: Record<RiskLevel, number> = {
    overdue: 0, blocked: 0, urgent: 0, slipping: 0, soon: 0, unscheduled: 0, normal: 0, done: 0,
  };
  for (const project of projects) {
    counts[projectRisk(project, today).level] += 1;
  }
  return RISK_LEVELS.map((level) => ({
    level, count: counts[level], label: RISK_META[level].label, tone: RISK_META[level].tone, rank: RISK_META[level].rank,
    percent: total === 0 ? 0 : Math.round((counts[level] / total) * 100),
  })).filter((slice) => slice.count > 0);
}

export interface ModuleLoad {
  module: string; accent: ModuleAccent; total: number; danger: number; watch: number;
  normal: number; avgProgress: number; openTasks: number;
}

/** 模块负载:每个模块的项目数、危险/关注/正常构成与平均进度。 */
export function moduleWorkload(projects: readonly Project[], today: string = todayISO()): ModuleLoad[] {
  const accents = moduleAccentMap(projects);
  return moduleNames(projects)
    .map((module) => {
      const items = projects.filter((project) => (project?.module || "其他项目") === module);
      const risks = items.map((project) => projectRisk(project, today));
      return {
        module, accent: accents[module],
        total: items.length,
        danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
        watch: risks.filter((risk) => WATCH_LEVELS.includes(risk.level)).length,
        normal: risks.filter((risk) => !DANGER_LEVELS.includes(risk.level) && !WATCH_LEVELS.includes(risk.level)).length,
        avgProgress: summarize(items, today).avgProgress,
        openTasks: items.reduce((sum, project) => sum + openTasks(project).length, 0),
      };
    })
    .filter((entry) => entry.total > 0);
}

export interface ProgressBucket {
  label: string;
  count: number;
}

/** 进度分布直方图。 */
export function progressBuckets(projects: readonly Project[]): ProgressBucket[] {
  const buckets: Array<{ label: string; test: (value: number) => boolean }> = [
    { label: "0%", test: (value) => value === 0 },
    { label: "1-25%", test: (value) => value > 0 && value <= 25 },
    { label: "26-50%", test: (value) => value > 25 && value <= 50 },
    { label: "51-75%", test: (value) => value > 50 && value <= 75 },
    { label: "76-99%", test: (value) => value > 75 && value < 100 },
    { label: "100%", test: (value) => value >= 100 },
  ];
  const values = projects.map((project) => clampProgress(project));
  return buckets.map((bucket) => ({ label: bucket.label, count: values.filter(bucket.test).length }));
}

export interface OwnerLoad {
  owner: string; total: number; danger: number; openTasks: number; avgProgress: number; projects: Project[];
}

/** 负责人负载。 */
export function ownerWorkload(projects: readonly Project[], today: string = todayISO()): OwnerLoad[] {
  const owners = new Map<string, Project[]>();
  for (const project of projects) {
    const owner = project?.owner?.trim() || "未指定";
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner)!.push(project);
  }
  return [...owners.entries()]
    .map(([owner, items]) => {
      const risks = items.map((project) => projectRisk(project, today));
      return {
        owner, total: items.length,
        danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
        openTasks: items.reduce((sum, project) => sum + openTasks(project).length, 0),
        avgProgress: summarize(items, today).avgProgress,
        projects: items,
      };
    })
    .sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner, "zh-Hans-CN"));
}

/** 概览页顶部的一句话结论(整句模板走 i18n 词典;消费点渲染期调用,不固化语言)。 */
export function headline(projects: readonly Project[], today: string = todayISO()): string {
  const data = kpis(projects, today);
  if (data.total === 0) return t("还没有项目,先登记几个再来看板。");
  if (data.overdue > 0) {
    return t("{total} 个项目里 {overdue} 个已逾期、{danger} 个需要马上处理,先看「需关注」这一列。", {
      total: data.total, overdue: data.overdue, danger: data.danger,
    });
  }
  if (data.attention > 0) {
    return t("{total} 个项目整体在跑,{attention} 个需要盯一下,本周到期 {weekDue} 个。", {
      total: data.total, attention: data.attention, weekDue: data.weekDue,
    });
  }
  return t("{total} 个项目节奏正常,平均进度 {avgProgress}%,没有逾期项。", {
    total: data.total, avgProgress: data.avgProgress,
  });
}

/** 概览「需要马上处理」行:危险级项目(复用 sortByRisk 排序)。 */
export function attentionRows(projects: readonly Project[], today: string = todayISO()) {
  return sortByRisk(projects, today).filter((item) => DANGER_LEVELS.includes(item.risk.level));
}

/** 项目卡上的任务微摘要:未完成任务总数 + 最近到期一条。 */
export function taskDigest(project: Project, today: string = todayISO()): { open: number; next?: ProjectTask } {
  const open = openTasks(project);
  const next = open
    .filter((task) => task.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  void today;
  return { open: open.length, next };
}

/** 风险等级 UI 标签:analysis.RISK_META 的 label 是内容层中文,界面展示统一走词典。 */
export const RISK_LABELS: Record<RiskLevel, string> = {
  overdue: "已逾期", blocked: "阻塞", urgent: "紧急", slipping: "进度风险",
  soon: "临近", unscheduled: "未排期", normal: "正常", done: "已完成",
};

/** 剩余天数/逾期 UI 文案:analysis.formatRemaining 是内容层中文,渲染端统一用这把。 */
export function remainingText(dueDate: string | undefined, today: string): string {
  const left = daysLeft(dueDate, today);
  if (left === null) return t("未排期");
  if (left < 0) return t("已逾期 {days} 天", { days: Math.abs(left) });
  if (left === 0) return t("今天到期");
  if (left === 1) return t("明天到期");
  return t("还剩 {days} 天", { days: left });
}
