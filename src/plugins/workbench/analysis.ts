/**
 * 工作台 · 组合分析纯函数(风险分级/日期演算/排序/汇总)。
 * 移植自 projectHub shared/analysis.js;差异:待跟进 todos 升级为任务实体,
 * openTodos(project) → openTasks(project)(done/cancelled 同为终结态)。
 * 时间一律本地日历日(YYYY-MM-DD)比较,避免时区把「还剩几天」算错。
 */

import { isTaskOpen, type Project, type ProjectStatus, type ProjectTask } from "./types";

export const MODULES = ["公司项目", "日常工作", "其他项目"] as const;
export const STATUSES = ["进行中", "待启动", "阻塞", "已完成", "暂停"] as const;

export type RiskLevel =
  | "overdue"
  | "blocked"
  | "urgent"
  | "slipping"
  | "soon"
  | "unscheduled"
  | "normal"
  | "done";

export type RiskTone = "danger" | "warn" | "muted" | "ok";

export const RISK_LEVELS: readonly RiskLevel[] = [
  "overdue", "blocked", "urgent", "slipping", "soon", "unscheduled", "normal", "done",
];

/** 风险等级的展示文案(内容层,与问答/文档生成同一语言体系;UI 直接显示)。 */
export const RISK_META: Record<RiskLevel, { label: string; tone: RiskTone; rank: number }> = {
  overdue: { label: "已逾期", tone: "danger", rank: 0 },
  blocked: { label: "阻塞", tone: "danger", rank: 1 },
  urgent: { label: "紧急", tone: "danger", rank: 2 },
  slipping: { label: "进度风险", tone: "warn", rank: 3 },
  soon: { label: "临近", tone: "warn", rank: 4 },
  unscheduled: { label: "未排期", tone: "muted", rank: 5 },
  normal: { label: "正常", tone: "ok", rank: 6 },
  done: { label: "已完成", tone: "muted", rank: 7 },
};

export const DANGER_LEVELS: readonly RiskLevel[] = ["overdue", "blocked", "urgent"];
export const WATCH_LEVELS: readonly RiskLevel[] = ["slipping", "soon"];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RiskInfo {
  level: RiskLevel;
  label: string;
  tone: RiskTone;
  rank: number;
  detail: string;
  remainingDays: number | null;
}

/** 风险排序后的行(项目 + 风险),视图层通用单位。 */
export interface RiskRow {
  project: Project;
  risk: RiskInfo;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** 本地日历日的 ISO 文本。 */
export function todayISO(now?: Date): string {
  const date = now ?? new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 把 YYYY-MM-DD 解析为本地零点的毫秒数;无法解析时返回 null。 */
export function dayStart(value: unknown): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** a 到 b 的整日差(b 晚于 a 为正)。 */
export function daysBetween(a: string, b: string): number | null {
  const from = dayStart(a);
  const to = dayStart(b);
  if (from === null || to === null) return null;
  return Math.round((to - from) / DAY_MS);
}

/** 剩余天数:负数表示已逾期。 */
export function daysLeft(dueDate: string | undefined, today: string = todayISO()): number | null {
  return dueDate ? daysBetween(today, dueDate) : null;
}

export function formatRemaining(dueDate: string | undefined, today: string = todayISO()): string {
  const left = daysLeft(dueDate, today);
  if (left === null) return "未排期";
  if (left < 0) return `已逾期 ${Math.abs(left)} 天`;
  if (left === 0) return "今天到期";
  if (left === 1) return "明天到期";
  return `还剩 ${left} 天`;
}

/** 本周最后一天(周日)。 */
export function endOfWeek(today: string = todayISO()): string {
  const start = dayStart(today);
  if (start === null) return today;
  const date = new Date(start);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? 0 : 7 - weekday));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 未完成任务(done/cancelled 同为终结态,均不算未完成)。 */
export function openTasks(project: Project): ProjectTask[] {
  return project.tasks.filter(isTaskOpen);
}

export function latestUpdate(project: Project) {
  if (project.updates.length === 0) return null;
  return project.updates.reduce((latest, item) =>
    String(item?.at ?? "") > String(latest?.at ?? "") ? item : latest,
  );
}

export function clampProgress(project: Project): number {
  const value = Number(project?.progress);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** 时间进度减实际进度;缺少开始日期或周期为零时返回 null。 */
export function slippage(project: Project, today: string = todayISO()): number | null {
  const start = dayStart(project?.startedOn);
  const due = dayStart(project?.dueDate);
  const now = dayStart(today);
  if (start === null || due === null || now === null || due <= start) return null;
  const elapsed = Math.min(1, Math.max(0, (now - start) / (due - start)));
  return elapsed - clampProgress(project) / 100;
}

/**
 * 单个项目的时间风险。
 * 顺序:已完成 → 已逾期 → 阻塞 → 未排期 → 紧急(≤3 天) → 进度落后 → 临近(≤7 天) → 正常。
 */
export function projectRisk(project: Project, today: string = todayISO()): RiskInfo {
  const meta = (level: RiskLevel, detail: string, remainingDays: number | null): RiskInfo => ({
    level, ...RISK_META[level], detail, remainingDays,
  });
  if (project?.status === "已完成") {
    return meta("done", "已交付", daysLeft(project?.dueDate, today));
  }
  if (project?.status === "阻塞") {
    return meta("blocked", "处于阻塞状态,需要推动", daysLeft(project?.dueDate, today));
  }
  const left = daysLeft(project?.dueDate, today);
  if (left === null) {
    return meta("unscheduled", "未设置截止日期", null);
  }
  if (left < 0) {
    return meta("overdue", `已超过截止日期 ${Math.abs(left)} 天`, left);
  }
  if (left <= 3) {
    return meta("urgent", left === 0 ? "今天到期" : `只剩 ${left} 天`, left);
  }
  const slip = slippage(project, today);
  if (slip !== null && slip >= 0.3) {
    const percent = Math.round(slip * 100);
    return meta("slipping", `时间已过 ${percent}% 但进度只有 ${clampProgress(project)}%`, left);
  }
  if (left <= 7) {
    return meta("soon", `还剩 ${left} 天`, left);
  }
  return meta("normal", `还剩 ${left} 天,节奏正常`, left);
}

/** 把项目按风险排序:危险在前,同级按剩余天数(少的在前),再按名称。 */
export function sortByRisk(projects: readonly Project[], today: string = todayISO()): RiskRow[] {
  return [...projects]
    .map((project) => ({ project, risk: projectRisk(project, today) }))
    .sort((a, b) => {
      if (a.risk.rank !== b.risk.rank) return a.risk.rank - b.risk.rank;
      const leftA = a.risk.remainingDays;
      const leftB = b.risk.remainingDays;
      if (leftA !== null && leftB !== null && leftA !== leftB) return leftA - leftB;
      if (leftA === null && leftB !== null) return 1;
      if (leftA !== null && leftB === null) return -1;
      return String(a.project.name).localeCompare(String(b.project.name), "zh-Hans-CN");
    });
}

/** 模块清单:固定三个模块在前,自定义模块按出现顺序补在后面。 */
const FIXED_MODULES = new Set<string>(MODULES);

export function moduleNames(projects: readonly Project[]): string[] {
  const extra = new Set<string>();
  for (const project of projects) {
    const module = project?.module || "其他项目";
    if (!FIXED_MODULES.has(module)) extra.add(module);
  }
  return [...MODULES, ...extra];
}

/** 整个工作台的概览:总数、状态分布、风险分布、模块小结、未完成任务清单。 */
export function overview(projects: readonly Project[], today: string = todayISO()) {
  const items = projects;
  const sorted = sortByRisk(items, today);
  const byStatus: Partial<Record<ProjectStatus, number>> = {};
  for (const project of items) {
    const status = project?.status || "进行中";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  const byRisk: Partial<Record<RiskLevel, number>> = {};
  for (const item of sorted) byRisk[item.risk.level] = (byRisk[item.risk.level] ?? 0) + 1;
  const followUps: Array<{ projectId: string; projectName: string; module: string } & ProjectTask> = [];
  for (const item of sorted) {
    for (const task of openTasks(item.project)) {
      followUps.push({
        projectId: item.project.id,
        projectName: item.project.name,
        module: item.project.module || "其他项目",
        ...task,
      });
    }
  }
  followUps.sort((a, b) => {
    const left = dayStart(a.dueDate);
    const right = dayStart(b.dueDate);
    if (left === null && right === null) return a.title.localeCompare(b.title, "zh-Hans-CN");
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });
  return {
    today,
    total: items.length,
    byStatus,
    byRisk,
    attention: sorted,
    modules: moduleNames(items).map((module) => {
      const own = module === "全部" ? items : items.filter((project) => (project?.module || "其他项目") === module);
      const risks = own.map((project) => projectRisk(project, today));
      return {
        module,
        total: own.length,
        active: own.filter((project) => project?.status === "进行中").length,
        done: own.filter((project) => project?.status === "已完成").length,
        danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
        watch: risks.filter((risk) => WATCH_LEVELS.includes(risk.level)).length,
        openTasks: own.reduce((sum, project) => sum + openTasks(project).length, 0),
      };
    }),
    followUps,
    dueSoon: sorted.filter((item) => ["overdue", "urgent", "soon"].includes(item.risk.level)),
  };
}

/** 按 id 找项目。 */
export function findProject(projects: readonly Project[], id: string): Project | null {
  return projects.find((project) => project?.id === id) ?? null;
}
