/**
 * 工作台 · 项目概要 dashboard 数据切片(纯函数,InfoDashboard 消费):
 * 任务看板四态分布与最近到期任务。只做过滤/计数/排序,不做 IO。
 */

import { isTaskOpen, BOARD_STATUSES, type Project, type ProjectTask, type TaskStatus } from "./types";

/** 看板四态计数(已取消不进分布,与看板同口径);total = 参与分布的任务数。 */
export function taskStatusCounts(tasks: readonly ProjectTask[]): { counts: Record<TaskStatus, number>; total: number } {
  const counts = { todo: 0, doing: 0, review: 0, done: 0, cancelled: 0 } as Record<TaskStatus, number>;
  for (const task of tasks) counts[task.status] += 1;
  const total = BOARD_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  return { counts, total };
}

/** 最近到期:未完成且有截止日的任务按日升序,取前 limit。 */
export function dueTasks(project: Project, limit: number): ProjectTask[] {
  return project.tasks
    .filter((task) => isTaskOpen(task) && task.dueDate !== undefined)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, limit);
}
