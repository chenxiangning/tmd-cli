/**
 * 工作台 · 视图纯函数:模块分组、小结、侧栏模块清单、工作区关联解析。
 * 移植自 projectHub shared/views.js;todos → tasks 口径同步。
 */

import {
  DANGER_LEVELS, WATCH_LEVELS, clampProgress, moduleNames, openTasks, projectRisk,
  sortByRisk, todayISO,
} from "./analysis";
import type { Workspace } from "@kernel/workspace";
import type { Project, ProjectTask, TaskSessionLink } from "./types";

export interface GroupStats {
  total: number;
  active: number;
  done: number;
  danger: number;
  watch: number;
  overdue: number;
  openTasks: number;
  avgProgress: number;
}

/** 一个模块(或「全部」)的小结,用于分组表头与侧栏计数。 */
export function summarize(projects: readonly Project[], today: string = todayISO()): GroupStats {
  const risks = projects.map((project) => projectRisk(project, today));
  return {
    total: projects.length,
    active: projects.filter((project) => (project?.status || "进行中") === "进行中").length,
    done: projects.filter((project) => (project?.status || "") === "已完成").length,
    danger: risks.filter((risk) => DANGER_LEVELS.includes(risk.level)).length,
    watch: risks.filter((risk) => WATCH_LEVELS.includes(risk.level)).length,
    overdue: risks.filter((risk) => risk.level === "overdue").length,
    openTasks: projects.reduce((sum, project) => sum + openTasks(project).length, 0),
    avgProgress: projects.length === 0
      ? 0
      : Math.round(projects.reduce((sum, project) => sum + clampProgress(project), 0) / projects.length),
  };
}

export interface RailModule {
  name: string;
  total: number;
  danger: number;
  overdue: number;
}

/** 侧栏模块清单:固定三个模块 + 出现过的自定义模块,带计数与风险点。 */
export function railModules(projects: readonly Project[], today: string = todayISO()): RailModule[] {
  return moduleNames(projects).map((name) => {
    const items = projects.filter((project) => (project?.module || "其他项目") === name);
    const stats = summarize(items, today);
    return { name, total: stats.total, danger: stats.danger + stats.watch, overdue: stats.overdue };
  });
}

export interface ModuleGroup {
  module: string;
  projects: Project[];
  stats: GroupStats;
}

/**
 * 按模块分组,用于「全部项目」下的分区展示。
 * 空模块不返回;自定义模块排在固定模块之后。
 */
export function groupByModule(projects: readonly Project[], today: string = todayISO()): ModuleGroup[] {
  return railModules(projects, today)
    .filter((entry) => entry.total > 0)
    .map((entry) => {
      const own = projects.filter((project) => (project?.module || "其他项目") === entry.name);
      return {
        module: entry.name,
        projects: sortByRisk(own, today).map((item) => item.project),
        stats: summarize(own, today),
      };
    });
}

/** 在册项目(单点过滤 selector):归档项目退出概览/看板/聚焦全部统计与列表
 * (WorkbenchTab 派生 screenProps 前统一过此筛,各视图不再各自判 archived)。 */
export function activeProjects(projects: readonly Project[]): Project[] {
  return projects.filter((project) => !project.archived);
}

/** 一键关联候选:未绑定过的工作区根(default 兜底工作区除外),保持工作区顺序。 */
export function linkableWorkspaces(workspaces: readonly Workspace[], projects: readonly Project[]): Workspace[] {
  const linked = new Set(projects.map((p) => p.cwd).filter((cwd) => cwd !== undefined));
  return workspaces.filter((w) => w.id !== "default" && !linked.has(w.root));
}

/** cwd → 工作区 id:root 精确命中优先,否则取最深路径前缀(项目绑在工作区
 *  子目录也能挂树);无命中 undefined。会话创建/恢复必带此 id —— 不带是孤儿,
 *  侧栏工作区树与运行时都不收。 */
export function resolveWorkspaceId(workspaces: readonly Workspace[], cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const exact = workspaces.find((w) => w.root === cwd);
  if (exact) return exact.id;
  let best: Workspace | undefined;
  for (const w of workspaces) {
    const base = w.root.endsWith("/") ? w.root : `${w.root}/`;
    if (cwd.startsWith(base) && (best === undefined || w.root.length > best.root.length)) best = w;
  }
  return best?.id;
}

/** 待自动纳管清单:status=todo 且任一关联会话 ref 命中活集合(消费方在
 *  useTaskAutoStatus;活集合 = 活会话 id ∪ CLI 磁盘身份,host/disk link 通吃)。 */
export function pendingAutoDoing(
  projects: readonly Project[],
  liveRefs: ReadonlySet<string>,
): Array<{ projectId: string; taskId: string }> {
  const hits: Array<{ projectId: string; taskId: string }> = [];
  for (const project of projects) {
    for (const task of project.tasks) {
      if (task.status === "todo" && task.sessions.some((link) => liveRefs.has(link.ref))) {
        hits.push({ projectId: project.id, taskId: task.id });
      }
    }
  }
  return hits;
}

/** 任务关联会话汇总:同 ref 跨任务去重,关联时间倒序(项目详情「会话」页签
 *  数据源;未关联到任务的 cwd 会话一律不进)。 */
export function collectLinkedSessions(tasks: readonly ProjectTask[]): TaskSessionLink[] {
  const seen = new Set<string>();
  const rows: TaskSessionLink[] = [];
  for (const task of tasks) {
    for (const link of task.sessions) {
      if (seen.has(link.ref)) continue;
      seen.add(link.ref);
      rows.push(link);
    }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
