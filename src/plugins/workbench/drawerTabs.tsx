/**
 * 工作台 · 抽屉页签内容:任务(表头 + 状态徽标表格 + 详情内嵌视图)、
 * 进展(左侧竖轨时间线)。文档页签在 DrawerDocsTab.tsx(300 行铁则拆分)。
 * 全部写穿 store,失败由 store 回滚并经 onToast 上抛。
 */

import { useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { Plus, X } from "@phosphor-icons/react";
import { openTasks, todayISO } from "./analysis";
import { TASK_ADVANCE_LABELS, TASK_STATUS_LABELS, UPDATE_KIND_LABELS, sortUpdates } from "./kindLabels";
import { taskStatusBadgeTone } from "./taskPrompt";
import { isTaskOpen, NEXT_TASK_STATUS, UPDATE_KINDS, type Project, type ProjectTask, type ProjectUpdate, type UpdateKind } from "./types";
import { deleteTask, deleteUpdate, addUpdate, updateTask } from "./store";
import { TaskDetailView } from "./TaskDetailView";
import { TaskFormView } from "./TaskFormView";
import { WbBadge, WbConfirm } from "./ui";
import { runIpc } from "./ipcToast";

/* ── 任务 ── */

export interface TaskFormState { open: boolean; task: ProjectTask | null }

export function DrawerTasksTab({ project, form, onFormChange, onToast }: {
  project: Project;
  /** 表单状态由 ProjectDetail 上提持有:概要页「建任务」可跳页签内嵌开单。 */
  form: TaskFormState;
  onFormChange: (form: TaskFormState) => void;
  onToast: (message: string) => void;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  /* 删除先确认:× 紧贴完成任务勾选区,单击即删曾误删。 */
  const [askDelete, setAskDelete] = useState<ProjectTask | null>(null);
  const detail = detailId === null ? null : project.tasks.find((task) => task.id === detailId) ?? null;
  /* 详情态/表单态整页替换列表(与文档编辑器同款「返回列表」内嵌)。 */
  if (detail) {
    return (
      <TaskDetailView
        key={detail.id}
        project={project}
        task={detail}
        onClose={() => setDetailId(null)}
        onToast={onToast}
      />
    );
  }
  if (form.open) {
    return (
      <TaskFormView
        key={form.task?.id ?? "new"}
        project={project}
        task={form.task}
        onClose={() => onFormChange({ open: false, task: null })}
        onToast={onToast}
      />
    );
  }
  const rows = [...openTasks(project), ...project.tasks.filter((task) => !isTaskOpen(task))];
  const open = openTasks(project).length;
  const today = todayISO();
  return (
    <div className="wb-tasks">
      <div className="wb-list-head">
        <h3>{t("任务")}<span className="wb-count">{open > 0 ? t("进行中 {n}", { n: open }) : rows.length}</span></h3>
        <button
          type="button" className="wb-btn wb-btn-primary"
          onClick={() => onFormChange({ open: true, task: null })}
        ><Plus size={12} />{t("建任务")}</button>
      </div>
      {rows.length === 0 ? <p className="wb-muted">{t("还没有任务。")}</p> : (
        <table className="wb-table wb-task-table">
          <thead>
            <tr><th>{t("任务")}</th><th>{t("状态")}</th><th>{t("负责人")}</th><th>{t("截止")}</th><th>{t("会话")}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((task) => {
              const overdue = isTaskOpen(task) && !!task.dueDate && task.dueDate < today;
              const next = NEXT_TASK_STATUS[task.status];
              return (
                <tr key={task.id} className={isTaskOpen(task) ? "" : "is-done"}>
                  <td><button type="button" className="wb-link" onClick={() => setDetailId(task.id)}>{task.title}</button></td>
                  <td>
                    <WbBadge tone={taskStatusBadgeTone(task.status)}>
                      {t(TASK_STATUS_LABELS[task.status])}
                    </WbBadge>
                  </td>
                  <td>{task.owner ?? "—"}</td>
                  <td className={overdue ? "wb-overdue" : ""}>{task.dueDate ?? "—"}</td>
                  <td>{task.sessions.length || "—"}</td>
                  <td>
                    <span className="wb-task-actions">
                      {next ? (
                        <button
                          type="button" className="wb-btn wb-btn-xs"
                          onClick={() => runIpc(updateTask(project.id, task.id, { status: next }), onToast, t("任务已更新"))}
                        >{t(TASK_ADVANCE_LABELS[next] ?? "")}</button>
                      ) : null}
                      <button type="button" className="wb-btn wb-btn-xs" onClick={() => onFormChange({ open: true, task })}>{t("编辑")}</button>
                      <button
                        type="button" className="wb-btn wb-btn-xs" aria-label={t("删除")}
                        onClick={() => setAskDelete(task)}
                      ><X size={11} /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {askDelete ? (
        <WbConfirm
          open
          title={t("删除任务")}
          body={t("将删除任务「{title}」及其附件,不可恢复。", { title: askDelete.title })}
          confirmLabel={t("删除")}
          onConfirm={() => {
            runIpc(deleteTask(project.id, askDelete.id), onToast, t("任务已删除"));
            setAskDelete(null);
          }}
          onCancel={() => setAskDelete(null)}
        />
      ) : null}
    </div>
  );
}

/* ── 进展 ── */

export function DrawerUpdatesTab({ project, onToast }: { project: Project; onToast: (message: string) => void }) {
  const [kind, setKind] = useState<UpdateKind>("progress");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [askDelete, setAskDelete] = useState<ProjectUpdate | null>(null);
  const submit = () => {
    if (text.trim() === "" || pending) return;
    /* 成功才清输入(TaskDetailView.tsx 保存描述同契约):失败留字可重试。
       在途守卫:写盘窗内二连点/按住回车会连发多条记录(旧版同步清空恰好挡住)。 */
    setPending(true);
    void addUpdate(project.id, kind, text.trim()).then(
      () => { onToast(t("进展已记录")); setText(""); setPending(false); },
      (e) => { onToast(errTextDisplay(e)); setPending(false); },
    );
  };
  return (
    <div className="wb-updates">
      <div className="wb-update-add">
        <select value={kind} aria-label={t("记录类型")} onChange={(e) => setKind(e.target.value as UpdateKind)}>
          {UPDATE_KINDS.map((item) => <option key={item} value={item}>{t(UPDATE_KIND_LABELS[item])}</option>)}
        </select>
        <input
          value={text} placeholder={t("发生了什么…")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            /* IME 组词回车(中文选词确认)不提交(kernel/shortcuts 纪律)。 */
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
        />
        <button type="button" className="wb-btn wb-btn-primary" onClick={submit} disabled={pending}>
          <Plus size={12} />{t("记录")}
        </button>
      </div>
      <ul className="wb-update-list">
        {sortUpdates(project.updates, "desc").map((update) => (
          <li key={update.id} className={`wb-update-row is-${update.kind}`}>
            <i className="wb-update-dot" aria-hidden />
            <div className="wb-update-body">
              <span className="wb-update-meta">{update.at.slice(0, 10)} · {t(UPDATE_KIND_LABELS[update.kind])}</span>
              <p>{update.text}</p>
            </div>
            <button
              type="button" className="wb-btn wb-btn-xs wb-attach-del" aria-label={t("删除")}
              onClick={() => setAskDelete(update)}
            ><X size={11} /></button>
          </li>
        ))}
      </ul>
      {askDelete ? (
        <WbConfirm
          open
          title={t("删除记录")}
          body={t("将删除该进展记录,不可恢复。")}
          confirmLabel={t("删除")}
          onConfirm={() => {
            runIpc(deleteUpdate(project.id, askDelete.id), onToast, t("记录已删除"));
            setAskDelete(null);
          }}
          onCancel={() => setAskDelete(null)}
        />
      ) : null}
    </div>
  );
}
