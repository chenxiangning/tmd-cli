/**
 * 工作台 · 任务看板(2026-10-10 三轮口径:看板以任务为主,项目状态列并入
 * 模块看板):待办/进行中/已完成 三列任务卡,就地推进,点击开任务详情弹层
 * (描述/附件/关联会话;会话打开即收工作台覆盖层落回侧栏,交互闭环)。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { TASK_STATUS_LABELS } from "../kindLabels";
import { updateTask } from "../store";
import { TASK_STATUSES, type Project, type ProjectTask, type TaskStatus } from "../types";
import { taskStatusTone } from "../taskPrompt";
import { TaskDetailDialog } from "../TaskDetailDialog";
import { TaskFormModal } from "../TaskFormModal";
import { BoardHead, type WbScreenProps } from "./cards";
import { WbEmpty } from "../ui";

interface TaskRow {
  task: ProjectTask;
  project: Project;
}

/** 列内序:未完成按截止升序(无截止沉底),已完成按完成时间倒序。 */
function columnRows(status: TaskStatus, projects: readonly Project[]): TaskRow[] {
  const rows = projects.flatMap((project) =>
    project.tasks.filter((task) => task.status === status).map((task) => ({ task, project })),
  );
  if (status === "done") {
    return rows.sort((a, b) => String(b.task.doneAt ?? "").localeCompare(String(a.task.doneAt ?? "")));
  }
  return rows.sort((a, b) => String(a.task.dueDate ?? "9999").localeCompare(String(b.task.dueDate ?? "9999")));
}

function TaskCard({ row, today, onDetail, onAdvance }: {
  row: TaskRow;
  today: string;
  onDetail: () => void;
  onAdvance: () => void;
}) {
  const { task, project } = row;
  const overdue = task.status !== "done" && task.dueDate !== undefined && task.dueDate < today;
  return (
    <div className={`wb-task-card${overdue ? " is-overdue" : ""}`}>
      <button type="button" className="wb-link" onClick={onDetail}>{task.title}</button>
      <span className="wb-task-project">{project.name}{task.owner ? ` · ${task.owner}` : ""}</span>
      <span className="wb-task-meta">
        <span className={overdue ? "wb-overdue" : undefined}>{task.dueDate ?? t("未排期")}</span>
        {task.sessions.length > 0 ? <span>{t("会话")} {task.sessions.length}</span> : null}
      </span>
      {task.status !== "done" ? (
        <span className="wb-task-actions">
          <button type="button" className="wb-btn wb-btn-xs" onClick={onAdvance}>
            {task.status === "todo" ? t("进行") : t("完成")}
          </button>
        </span>
      ) : null}
    </div>
  );
}

export function TaskBoardScreen({ projects, today, onNewProject, onToast }: WbScreenProps) {
  const [detail, setDetail] = useState<{ projectId: string; taskId: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  if (projects.length === 0) {
    return <WbEmpty text={t("当前筛选下没有项目。")}><button type="button" className="wb-btn" onClick={onNewProject}>{t("新建项目")}</button></WbEmpty>;
  }
  const total = projects.reduce((sum, project) => sum + project.tasks.length, 0);
  const detailProject = detail === null ? null : projects.find((project) => project.id === detail.projectId) ?? null;
  const detailTask = detailProject?.tasks.find((task) => task.id === detail?.taskId) ?? null;
  const advance = (row: TaskRow) => {
    const status: TaskStatus = row.task.status === "todo" ? "doing" : "done";
    void updateTask(row.project.id, row.task.id, { status }).then(
      () => onToast(t("任务已更新")),
      () => onToast(t("任务更新失败")),
    );
  };
  return (
    <div className="wb-board">
      <div className="wb-board-head-row">
        <BoardHead label={t("全部任务")} count={total} />
        <button type="button" className="wb-btn wb-btn-primary" onClick={() => setFormOpen(true)}>{t("建任务")}</button>
      </div>
      {total === 0 ? (
        <p className="wb-muted">{t("还没有任务;在项目详情或这里直接建任务。")}</p>
      ) : (
        <div className="wb-task-board">
          {TASK_STATUSES.map((status) => {
            const rows = columnRows(status, projects);
            return (
              <div key={status} className="wb-task-col">
                <h4 className="wb-status-head" style={{ color: taskStatusTone(status) }}>
                  <b>{t(TASK_STATUS_LABELS[status])}</b>
                  <span>{rows.length}</span>
                </h4>
                <div className="wb-task-cards">
                  {rows.map((row) => (
                    <TaskCard
                      key={`${row.project.id}:${row.task.id}`} row={row} today={today}
                      onDetail={() => setDetail({ projectId: row.project.id, taskId: row.task.id })}
                      onAdvance={() => advance(row)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="wb-muted">{t("状态可手动推进;关联会话运行中会自动推进为进行中,也可由 AI 按 AI-TASKS.md 规则回写(顶栏「从磁盘同步」刷新)。")}</p>
      {detailProject && detailTask ? (
        <TaskDetailDialog
          key={detailTask.id}
          project={detailProject}
          task={detailTask}
          onClose={() => setDetail(null)}
          onToast={onToast}
        />
      ) : null}
      {formOpen ? (
        <TaskFormModal
          project={projects[0]}
          projects={projects}
          task={null}
          onClose={() => setFormOpen(false)}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}
