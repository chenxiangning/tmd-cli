/**
 * 工作台 · 任务看板(2026-10-12 五态化重构):项目为行、状态为列的泳道看板
 * (待办/进行中/待验收/已完成;已取消不占列,详情页下拉设置),状态列头吸顶;
 * 泳道头 = 折叠开关 + 项目名(点击开项目详情)+ 风险徽标 + 任务计数。
 * 卡片整卡可拖(原生 HTML5 DnD,同泳道跨列放置即改态,纯逻辑在 boardDnd.ts);
 * 推进钮走 NEXT_TASK_STATUS 链;已完成列默认只显示近 7 天,更早收进「+N 更早」。
 * 点击卡片进任务详情内嵌视图(描述/附件/关联会话;会话打开即收工作台覆盖层)。
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { TASK_STATUS_LABELS } from "../kindLabels";
import { updateTask } from "../store";
import { BOARD_STATUSES, NEXT_TASK_STATUS, type Project, type TaskStatus } from "../types";
import { taskStatusTone } from "../taskPrompt";
import { TaskDetailView } from "../TaskDetailView";
import { TaskFormView } from "../TaskFormView";
import { BoardHead, RiskPill, type WbScreenProps } from "./cards";
import { WbEmpty } from "../ui";
import { BOARD_DND_TYPE, canDrop, isRecentDone, type BoardDrag } from "./boardDnd";
import { TaskCard, type TaskRow } from "./TaskCard";

/* 泳道折叠态 localStorage 自持(journal 视图态同口径;组件局部态切页即丢)。 */
const BOARD_FOLD_KEY = "wb.boardCollapsed";

function loadFolded(): ReadonlySet<string> {
  /* try/catch 包解析:脏数据/隐私模式回落全展开,不影响功能。 */
  try {
    const raw = localStorage.getItem(BOARD_FOLD_KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
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

/** 泳道:有看板可见任务的项目各占一行(保持传入的风险排序);空项目/仅已取消项目不成道。 */
function boardLanes(projects: readonly Project[]): { project: Project; rows: TaskRow[] }[] {
  return projects
    .map((project) => ({
      project,
      rows: BOARD_STATUSES.flatMap((status) => columnRows(status, [project])),
    }))
    .filter((lane) => lane.rows.length > 0);
}

export function TaskBoardScreen({ projects, today, onOpen, onNewProject, onToast, boardFormOpen }: WbScreenProps) {
  const [detail, setDetail] = useState<{ projectId: string; taskId: string } | null>(null);
  const [formOpen, setFormOpen] = useState(boardFormOpen ?? false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(loadFolded);
  useEffect(() => {
    try {
      localStorage.setItem(BOARD_FOLD_KEY, JSON.stringify([...folded]));
    } catch { /* 配额满/隐私模式:折叠态不持久,不影响功能。 */ }
  }, [folded]);
  /* 推进在途集合(项目/任务键):二连点防护。 */
  const [advancing, setAdvancing] = useState<ReadonlySet<string>>(new Set());
  /* 编辑态:非 null 时表单页整页替换看板并带任务进编辑模式(TaskFormView task!=null 即 updateTask)。 */
  const [editing, setEditing] = useState<TaskRow | null>(null);
  /* 拖拽负载与高亮列(state 承载:dragover 期 dataTransfer 数据不可读);done 列「更早」展开态(会话内,不持久)。 */
  const [drag, setDrag] = useState<BoardDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<{ projectId: string; status: TaskStatus } | null>(null);
  const [doneExpanded, setDoneExpanded] = useState<ReadonlySet<string>>(new Set());
  /* F5:泳道/列装配/列头计数一次派生(projects 引用不变即复用),消渲染期逐列全表重扫。 */
  const lanes = useMemo(() => boardLanes(projects), [projects]);
  const columnsByProject = useMemo(() => {
    const map = new Map<string, ReadonlyMap<TaskStatus, TaskRow[]>>();
    for (const project of projects) {
      map.set(project.id, new Map(BOARD_STATUSES.map((status) => [status, columnRows(status, [project])])));
    }
    return map;
  }, [projects]);
  const statusTotals = useMemo(() => {
    const totals = new Map<TaskStatus, number>();
    for (const columns of columnsByProject.values()) {
      for (const status of BOARD_STATUSES) {
        totals.set(status, (totals.get(status) ?? 0) + (columns.get(status)?.length ?? 0));
      }
    }
    return totals;
  }, [columnsByProject]);
  /* A6:已取消不占列,也不进「全部任务 N」总数(否则与四列头对不上)。 */
  const total = useMemo(
    () => projects.reduce((sum, project) => sum + project.tasks.filter((task) => task.status !== "cancelled").length, 0),
    [projects],
  );
  if (projects.length === 0) {
    return <WbEmpty text={t("还没有项目。")}><button type="button" className="wb-btn" onClick={onNewProject}>{t("新建项目")}</button></WbEmpty>;
  }
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
  /* 表单态整页替换看板(内嵌,「返回列表」回落);editing 非 null 时带任务进编辑模式。 */
  if (formOpen || editing) {
    return (
      <div className="wb-board">
        <TaskFormView
          key={editing?.task.id ?? "new"}
          project={editing?.project ?? projects[0]}
          projects={projects}
          task={editing?.task ?? null}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onToast={onToast}
        />
      </div>
    );
  }
  const setStatusOf = (projectId: string, taskId: string, status: TaskStatus) => {
    const key = `${projectId}/${taskId}`;
    if (advancing.has(key)) return;
    setAdvancing((prev) => new Set(prev).add(key));
    void updateTask(projectId, taskId, { status }).then(
      () => onToast(t("任务已更新")),
      () => onToast(t("任务更新失败")),
    ).finally(() => setAdvancing((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    }));
  };
  const advance = (row: TaskRow) => {
    const next = NEXT_TASK_STATUS[row.task.status];
    if (next) setStatusOf(row.project.id, row.task.id, next);
  };
  /* 拖拽:dargover 命中合法列才 preventDefault(放行 drop);高亮列 = 最后 dragover 命中的列,drop/dragend 清。 */
  const colDragOver = (projectId: string, status: TaskStatus) => (e: DragEvent<HTMLDivElement>) => {
    if (!canDrop(drag, projectId, status) || !e.dataTransfer.types.includes(BOARD_DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget((prev) => (prev?.projectId === projectId && prev.status === status ? prev : { projectId, status }));
  };
  const colDrop = (projectId: string, status: TaskStatus) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (drag && canDrop(drag, projectId, status)) setStatusOf(drag.projectId, drag.taskId, status);
    setDrag(null);
    setDropTarget(null);
  };
  const dragEnd = () => {
    setDrag(null);
    setDropTarget(null);
  };
  const toggleDone = (projectId: string) =>
    setDoneExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
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
            {BOARD_STATUSES.map((status) => (
              <h4 key={status} className="wb-status-head">
                <i className="wb-status-dot" style={{ background: taskStatusTone(status) }} />
                <b>{t(TASK_STATUS_LABELS[status])}</b>
                <span className="wb-status-count">{statusTotals.get(status) ?? 0}</span>
              </h4>
            ))}
          </div>
          {lanes.map(({ project, rows }) => {
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
                {isFolded ? null : BOARD_STATUSES.map((status) => {
                  const all = columnsByProject.get(project.id)?.get(status) ?? [];
                  const expanded = doneExpanded.has(project.id);
                  const visible = status === "done" && !expanded ? all.filter((row) => isRecentDone(row.task, today)) : all;
                  const hiddenCount = all.length - visible.length;
                  const isTarget = dropTarget?.projectId === project.id && dropTarget.status === status;
                  return (
                    <div
                      key={status}
                      className={`wb-lane-col${isTarget ? " is-drop-target" : ""}`}
                      onDragOver={colDragOver(project.id, status)}
                      onDrop={colDrop(project.id, status)}
                    >
                      {visible.map((row) => (
                        <TaskCard
                          key={row.task.id} row={row} today={today}
                          busy={advancing.has(`${row.project.id}/${row.task.id}`)}
                          dragging={drag?.taskId === row.task.id}
                          onDetail={() => setDetail({ projectId: row.project.id, taskId: row.task.id })}
                          onEdit={() => setEditing(row)}
                          onAdvance={() => advance(row)}
                          onSetStatus={(status) => setStatusOf(row.project.id, row.task.id, status)}
                          onDragStart={setDrag}
                          onDragEnd={dragEnd}
                        />
                      ))}
                      {/* A7:done 列有隐藏任务时说明并非真空列,空态占位与「+N 更早」互斥。 */}
                      {visible.length === 0 && hiddenCount === 0 ? <div className="wb-lane-empty" aria-hidden="true">{t("拖到此列")}</div> : null}
                      {hiddenCount > 0 ? (
                        <button type="button" className="wb-lane-more" onClick={() => toggleDone(project.id)}>
                          {t("+{n} 更早", { n: hiddenCount })}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
      <p className="wb-muted">{t("拖拽卡片跨列改状态,或点卡片右下角按钮逐档推进;关联会话运行中自动推进为进行中,也可由 AI 按 AI-TASKS.md 规则回写(自动刷新)。")}</p>
    </div>
  );
}
