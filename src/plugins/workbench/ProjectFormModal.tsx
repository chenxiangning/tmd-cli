/**
 * 工作台 · 项目表单弹窗(新建/编辑共用)。字段:名称/模块/状态/负责人/
 * 起止日期/进度/说明/标签/绑定 cwd/链接。cwd 提供现有工作区根的 datalist。
 */

import { useRef, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { WbConfirm } from "./ui";
import { MODULES, STATUSES, moduleNames } from "./analysis";
import type { Project, ProjectStatus } from "./types";

export interface ProjectFormValues {
  name: string;
  module: string;
  status: ProjectStatus;
  owner: string;
  startedOn: string;
  dueDate: string;
  progress: number;
  summary: string;
  tags: string[];
  cwd: string;
  link: string;
}

function toValues(project: Project | null): ProjectFormValues {
  return {
    name: project?.name ?? "",
    module: project?.module ?? "",
    status: project?.status ?? "进行中",
    owner: project?.owner ?? "",
    startedOn: project?.startedOn ?? "",
    dueDate: project?.dueDate ?? "",
    progress: project?.progress ?? 0,
    summary: project?.summary ?? "",
    tags: project?.tags ?? [],
    cwd: project?.cwd ?? "",
    link: project?.link ?? "",
  };
}

export function ProjectFormModal({
  project, onClose, onSubmit,
}: {
  project: Project | null;
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState(() => toValues(project));
  const [tagText, setTagText] = useState(() => (project?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 脏标只被 requestClose 读(渲染不依赖),用 ref 免多余重渲;重挂随 key 复位。 */
  const dirtyRef = useRef(false);
  const [askDiscard, setAskDiscard] = useState(false);
  /* 项目切换由调用方 key={project.id ?? "new"} 重挂复位,不写 prop→state 同步 effect。 */
  const { list } = useWorkspaces();
  const knownModules = [...MODULES, ...moduleNames([])];
  const patch = (part: Partial<ProjectFormValues>) => { dirtyRef.current = true; setValues((prev) => ({ ...prev, ...part })); };
  /* Esc/点背板/取消共用:已填字段(脏)先确认,busy 期维持禁用(DialogShell locked)。 */
  const requestClose = () => {
    if (dirtyRef.current) { setAskDiscard(true); return; }
    onClose();
  };

  const submit = () => {
    if (values.name.trim() === "") {
      setError(t("项目名称不能为空"));
      return;
    }
    if (values.startedOn !== "" && values.dueDate !== "" && values.startedOn > values.dueDate) {
      setError(t("开始日期不能晚于截止日期"));
      return;
    }
    setBusy(true);
    /* 兜底值落库保持规范中文(存层内容态);展示态经 placeholder 走 t()。 */
    onSubmit({
      ...values,
      name: values.name.trim(),
      owner: values.owner.trim() || "我",
      module: values.module.trim() || "其他项目",
      tags: tagText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      cwd: values.cwd.trim() || "",
    }).then(onClose).catch((e) => {
      setError(errTextDisplay(e));
      setBusy(false);
    });
  };

  return (
    <DialogShell
      title={project ? t("编辑项目") : t("新建项目")}
      icon={null}
      width={560}
      locked={busy}
      onClose={requestClose}
      footer={<DialogActions confirmLabel={busy ? t("保存中…") : t("保存")} submitting={busy} onConfirm={submit} onCancel={requestClose} />}
    >
      <div className="wb-form-grid">
          <label className="wb-field wb-span2">
            <span>{t("项目名称")} *</span>
            <input value={values.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className="wb-field">
            <span>{t("模块")}</span>
            <input list="wb-module-options" value={values.module} placeholder={t("其他项目")} onChange={(e) => patch({ module: e.target.value })} />
            <datalist id="wb-module-options">
              {[...new Set([...knownModules, values.module])].map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label className="wb-field">
            <span>{t("状态")}</span>
            <select value={values.status} onChange={(e) => patch({ status: e.target.value as ProjectStatus })}>
              {STATUSES.map((status) => <option key={status} value={status}>{t(status)}</option>)}
            </select>
          </label>
          <label className="wb-field">
            <span>{t("负责人")}</span>
            <input value={values.owner} placeholder={t("我")} onChange={(e) => patch({ owner: e.target.value })} />
          </label>
          <label className="wb-field">
            <span>{t("进度")} {values.progress}%</span>
            <input type="range" min={0} max={100} value={values.progress} onChange={(e) => patch({ progress: Number(e.target.value) })} />
          </label>
          <label className="wb-field">
            <span>{t("开始日期")}</span>
            <input type="date" value={values.startedOn} onChange={(e) => patch({ startedOn: e.target.value })} />
          </label>
          <label className="wb-field">
            <span>{t("截止日期")}</span>
            <input type="date" value={values.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} />
          </label>
          <label className="wb-field">
            <span>{t("标签")}</span>
            <input value={tagText} placeholder="示例, 后端" onChange={(e) => { dirtyRef.current = true; setTagText(e.target.value); }} />
          </label>
          <label className="wb-field">
            <span>{t("链接")}</span>
            <input value={values.link} placeholder="https://…" onChange={(e) => patch({ link: e.target.value })} />
          </label>
          <label className="wb-field wb-span2">
            <span>{t("绑定工作区目录(可选,绑定后可在该目录开会话并与任务关联)")}</span>
            <input list="wb-cwd-options" value={values.cwd} placeholder="/path/to/project" onChange={(e) => patch({ cwd: e.target.value })} />
            <datalist id="wb-cwd-options">
              {list.map((workspace) => <option key={workspace.id} value={workspace.root}>{workspace.name}</option>)}
            </datalist>
          </label>
          <label className="wb-field wb-span2">
            <span>{t("一句话说明")}</span>
            <textarea rows={2} value={values.summary} onChange={(e) => patch({ summary: e.target.value })} />
          </label>
        </div>
        {error ? <p className="wb-form-error">{error}</p> : null}
        {askDiscard ? (
          <WbConfirm
            open
            title={t("丢弃修改")}
            body={t("未保存的修改将丢失。")}
            confirmLabel={t("丢弃")}
            onConfirm={() => { setAskDiscard(false); onClose(); }}
            onCancel={() => setAskDiscard(false)}
          />
        ) : null}
    </DialogShell>
  );
}
