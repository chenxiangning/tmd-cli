/**
 * 工作台 · 任务表单弹窗(新建/编辑共用):项目/名称/负责人/起止/描述。
 * 新建走 addTask(init),编辑走 updateTask(patch)。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { todayISO } from "./analysis";
import { addTask, updateTask } from "./store";
import type { Project, ProjectTask } from "./types";

export interface TaskFormValues {
  projectId: string;
  title: string;
  owner: string;
  startedOn: string;
  dueDate: string;
  description: string;
}

export function TaskFormModal({
  projects, project, task, onClose, onToast, onDone,
}: {
  /** 可选项目集(覆盖层全量);缺省 = 单项目语境。 */
  projects?: readonly Project[];
  /** 单项目语境(项目抽屉内)。 */
  project: Project;
  /** 编辑目标;null = 新建。 */
  task: ProjectTask | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onDone?: () => void;
}) {
  /* 新建缺省:负责人随项目,开始日=今天(编辑保持原值)。 */
  const [projectId, setProjectId] = useState(project.id);
  const [title, setTitle] = useState(task?.title ?? "");
  const [owner, setOwner] = useState(task?.owner ?? project.owner);
  const [startedOn, setStartedOn] = useState(task?.startedOn ?? (task ? "" : todayISO()));
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = () => {
    if (busy) return;
    if (title.trim() === "") {
      setError(t("任务标题不能为空"));
      return;
    }
    setBusy(true);
    const values = { title: title.trim(), owner: owner.trim(), startedOn, dueDate, description };
    const job = task
      ? updateTask(projectId, task.id, values)
      : addTask(projectId, values);
    void job.then(
      () => { onToast(task ? t("任务已更新") : t("任务已添加")); onDone?.(); onClose(); },
      (e) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); },
    );
  };

  return (
    <DialogShell
      title={task ? t("编辑任务") : t("建任务")}
      icon={null}
      width={520}
      locked={busy}
      onClose={onClose}
      footer={<DialogActions confirmLabel={busy ? t("保存中…") : t("保存")} submitting={busy} onConfirm={submit} onCancel={onClose} />}
    >
      <div className="wb-form-grid">
        {projects && projects.length > 1 && !task ? (
          <label className="wb-field wb-span2">
            <span>{t("所属项目")}</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="wb-field wb-span2">
          <span>{t("任务名称")} <i className="wb-req">*</i></span>
          <input
            ref={titleRef} value={title}
            placeholder={t("要做什么…")}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
        <label className="wb-field">
          <span>{t("负责人")}</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
        <div className="wb-field">
          <span>{t("日程规划")}</span>
          <span className="wb-datepair">
            <input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} aria-label={t("开始")} />
            <span className="wb-datepair-sep">→</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label={t("截止")} />
          </span>
        </div>
        <label className="wb-field wb-span2">
          <span>{t("任务描述")}</span>
          <textarea rows={4} value={description} placeholder={t("任务目标、验收标准、相关链接…")} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      {error ? <p className="wb-form-error">{error}</p> : null}
    </DialogShell>
  );
}
