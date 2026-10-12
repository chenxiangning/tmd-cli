/**
 * 工作台 · 看板任务卡(自 TaskBoard.tsx 拆出守 300 行铁则):
 * 标题(点击进详情)+ 负责人缩写圆标 + 截止 pill(逾期红)+ 会话计数;
 * 整卡可拖(HTML5 原生 DnD,负载由父级 state 承载),推进钮走 NEXT_TASK_STATUS 链。
 */

import type { DragEvent } from "react";
import { t } from "@kernel/i18n";
import { ChatCircle } from "@phosphor-icons/react";
import { TASK_ADVANCE_LABELS } from "../kindLabels";
import { isTaskOpen, NEXT_TASK_STATUS, type Project, type ProjectTask } from "../types";
import { BOARD_DND_TYPE, type BoardDrag } from "./boardDnd";

export interface TaskRow {
  task: ProjectTask;
  project: Project;
}

export function TaskCard({ row, today, busy, dragging, onDetail, onAdvance, onDragStart, onDragEnd }: {
  row: TaskRow;
  today: string;
  /** 推进请求在途:禁用推进钮,防快照回写间隙二连点连跳两档。 */
  busy: boolean;
  /** 本卡正被拖拽:半透明示意,放置前不消失(放置写库后快照刷新自然换列)。 */
  dragging: boolean;
  onDetail: () => void;
  onAdvance: () => void;
  onDragStart: (drag: BoardDrag) => void;
  onDragEnd: () => void;
}) {
  const { task, project } = row;
  const overdue = isTaskOpen(task) && task.dueDate !== undefined && task.dueDate < today;
  const next = NEXT_TASK_STATUS[task.status];
  const startDrag = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(BOARD_DND_TYPE, task.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart({ projectId: project.id, taskId: task.id, status: task.status });
  };
  return (
    <div
      className={`wb-task-card${overdue ? " is-overdue" : ""}${dragging ? " is-dragging" : ""}`}
      draggable
      onDragStart={startDrag}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="wb-link wb-task-card-title" onClick={onDetail}>{task.title}</button>
      <span className="wb-task-meta">
        {task.owner ? <span className="wb-task-owner" title={task.owner}>{task.owner.slice(0, 1)}</span> : null}
        <span className={`wb-task-due${overdue ? " is-overdue" : ""}`}>{task.dueDate ?? t("未排期")}</span>
        {task.sessions.length > 0 ? (
          <span className="wb-task-sessions" title={t("关联会话 {n}", { n: task.sessions.length })}>
            <ChatCircle size="0.6875rem" aria-hidden />{task.sessions.length}
          </span>
        ) : null}
      </span>
      {next ? (
        <span className="wb-task-actions">
          <button type="button" className="wb-btn wb-btn-xs" onClick={onAdvance} disabled={busy}>
            {t(TASK_ADVANCE_LABELS[next] ?? "")}
          </button>
        </span>
      ) : null}
    </div>
  );
}
