/**
 * 工作台 · 任务看板(2026-10-11 泳道化):项目为行、状态为列的项目泳道看板
 * (待办/进行中/已完成),状态列头吸顶;泳道头 = 折叠开关 + 项目名(点击开
 * 项目详情)+ 风险徽标 + 任务计数。任务卡就地推进,点击进任务详情内嵌视图
 * (描述/附件/关联会话;会话打开即收工作台覆盖层落回侧栏,交互闭环)。
 */

import { useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { TASK_STATUS_LABELS } from "../kindLabels";
import { updateTask } from "../store";
import { TASK_STATUSES, type Project, type ProjectTask, type TaskStatus } from "../types";
import { taskStatusTone } from "../taskPrompt";
import { TaskDetailView } from "../TaskDetailView";
import { TaskFormView } from "../TaskFormView";
import { BoardHead, RiskPill, type WbScreenProps } from "./cards";
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

/** 泳道:有任务的项目各占一行(保持传入的风险排序),行内沿用列内序;空项目不成道。 */
function boardLanes(projects: readonly Project[]): { project: Project; rows: TaskRow[] }[] {
  return projects
    .map((project) => ({
      project,
      rows: TASK_STATUSES.flatMap((status) => columnRows(status, [project])),
    }))
    .filter((lane) => lane.rows.length > 0);
}

function TaskCard({ row, today, onDetail, onAdvance }: {
  row: TaskRow;
  today: string;
  onDetail: () => void;
  onAdvance: () => void;
}) {
  const { task } = row;
  const overdue = task.status !== "done" && task.dueDate !== undefined && task.dueDate < today;
  return (
    <div className={`wb-task-card${overdue ? " is-overdue" : ""}`}>
      <button type="button" className="wb-link" onClick={onDetail}>{task.title}</button>
      {task.owner ? <span className="wb-task-owner">{task.owner}</span> : null}
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

export function TaskBoardScreen({ projects, today, onOpen, onNewProject, onToast }: WbScreenProps) {
  const [detail, setDetail] = useState<{ projectId: string; taskId: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (projects.length === 0) {
    return <WbEmpty text={t("当前筛选下没有项目。")}><button type="button" className="wb-btn" onClick={onNewProject}>{t("新建项目")}</button></WbEmpty>;
  }
  const total = projects.reduce((sum, project) => sum + project.tasks.length, 0);
  const detailProject = detail === null ? null : projects.find((project) => project.id === detail.projectId) ?? null;
  const detailTask = detailProject?.tasks.find((task) => task.id === detail?.taskId) ?? null;
  /* 详情态整页替换看板(内嵌视图,「返回列表」回落看板)。 */
  if (detailProject && detailTask) {
    return (
      <div className="wb-board">
        <TaskDetailView
          key={detailTask.id}
          project={detailProject}
          task={detailTask}
          onClose={() => setDetail(null)}
          onToast={onToast}
        />
      </div>
    );
  }
  /* 表单态整页替换看板(内嵌,「返回列表」回落)。 */
  if (formOpen) {
    return (
      <div className="wb-board">
        <TaskFormView
          project={projects[0]}
          projects={projects}
          task={null}
          onClose={() => setFormOpen(false)}
          onToast={onToast}
        />
      </div>
    );
  }
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
          <div className="wb-lane-grid wb-lane-cols">
            <span aria-hidden="true" />
            {TASK_STATUSES.map((status) => (
              <h4 key={status} className="wb-status-head" style={{ color: taskStatusTone(status) }}>
                <b>{t(TASK_STATUS_LABELS[status])}</b>
                <span>{columnRows(status, projects).length}</span>
              </h4>
            ))}
          </div>
          {boardLanes(projects).map(({ project, rows }) => {
            const isFolded = folded.has(project.id);
            const toggleFold = () =>
              setFolded((prev) => {
                const next = new Set(prev);
                if (next.has(project.id)) next.delete(project.id);
                else next.add(project.id);
                return next;
              });
            return (
              <section key={project.id} className="wb-lane-grid wb-lane">
                <div className="wb-lane-head">
                  <button
                    type="button" className="wb-lane-fold" aria-expanded={!isFolded}
                    aria-label={isFolded ? t("展开") : t("收起")}
                    onClick={toggleFold}
                  >
                    {isFolded ? <CaretRight size="0.75rem" /> : <CaretDown size="0.75rem" />}
                  </button>
                  <button type="button" className="wb-lane-title" onClick={() => onOpen(project.id)}>
                    <b>{project.name}</b>
                    <RiskPill project={project} today={today} />
                    <span className="wb-lane-count">{rows.length}</span>
                  </button>
                </div>
                {isFolded ? null : TASK_STATUSES.map((status) => (
                  <div key={status} className="wb-lane-col">
                    {columnRows(status, [project]).map((row) => (
                      <TaskCard
                        key={row.task.id} row={row} today={today}
                        onDetail={() => setDetail({ projectId: row.project.id, taskId: row.task.id })}
                        onAdvance={() => advance(row)}
                      />
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      <p className="wb-muted">{t("状态可手动推进;关联会话运行中会自动推进为进行中,也可由 AI 按 AI-TASKS.md 规则回写(顶栏「从磁盘同步」刷新)。")}</p>
    </div>
  );
}
