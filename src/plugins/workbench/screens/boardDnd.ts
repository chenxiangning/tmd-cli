/**
 * 工作台 · 任务看板拖拽纯逻辑(无组件,守 only-export-components 与 300 行铁则):
 * HTML5 原生 DnD 的放置合法性(同泳道、异列)与已完成列「近 7 天」窗口判定。
 * dragover 期浏览器只允许读 dataTransfer.types 读不到数据,负载由 React state 承载,
 * dataTransfer 只写通道标记(自定义 type),drop 时以 state 为准。
 */

import type { ProjectTask, TaskStatus } from "../types";

/** 拖拽负载:任务身份 + 起拖列。 */
export interface BoardDrag {
  projectId: string;
  taskId: string;
  status: TaskStatus;
}

/** dataTransfer 通道标记(type 存在性 = 本看板内的拖拽,外部文件拖入不放行)。 */
export const BOARD_DND_TYPE = "application/x-tmd-wb-task";

/** 放置合法 = 同项目泳道内且目标列不是起拖列(同列回拖算 no-op 高亮都不给)。 */
export function canDrop(drag: BoardDrag | null, projectId: string, status: TaskStatus): boolean {
  return drag !== null && drag.projectId === projectId && drag.status !== status;
}

/** done 列「近 7 天」窗口(含今天共 7 个日历日):doneAt 的日历日 >= today-6 天。
 *  缺失/非法 doneAt 视为历史任务,收进「更早」(归一化保证 done 任务必有 doneAt,这里是防御)。 */
export function isRecentDone(task: Pick<ProjectTask, "doneAt">, today: string): boolean {
  const day = task.doneAt?.slice(0, 10);
  if (!day) return false;
  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(base.getTime())) return true;
  base.setDate(base.getDate() - 6);
  const p = (n: number) => String(n).padStart(2, "0");
  return day >= `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
}
