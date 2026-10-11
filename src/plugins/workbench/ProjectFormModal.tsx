/**
 * 工作台 · 项目表单弹窗(新建/编辑共用)。字段:名称/模块/状态/负责人/
 * 起止日期/进度/说明/标签/绑定 cwd/链接。cwd 提供现有工作区根的 datalist。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
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
    module: project?.module ?? "其他项目",
    status: project?.status ?? "进行中",
    owner: project?.owner ?? "我",
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
  /* 项目切换由调用方 key={project.id ?? "new"} 重挂复位,不写 prop→state 同步 effect。 */
  const { list } = useWorkspaces();
  const knownModules = [...MODULES, ...moduleNames([])];
  const patch = (part: Partial<ProjectFormValues>) => setValues((prev) => ({ ...prev, ...part }));

  const submit = () => {
    if (values.name.trim() === "") {
      setError(t("项目名称不能为空"));
      return;
    }
    setBusy(true);
    onSubmit({
      ...values,
      name: values.name.trim(),
      owner: values.owner.trim() || "我",
      module: values.module.trim() || "其他项目",
      tags: tagText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      cwd: values.cwd.trim() || "",
    }).then(onClose).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  return (
    <DialogShell
      title={project ? t("编辑项目") : t("新建项目")}
      icon={null}
      width={560}
      locked={busy}
      onClose={onClose}
      footer={<DialogActions confirmLabel={busy ? t("保存中…") : t("保存")} submitting={busy} onConfirm={submit} onCancel={onClose} />}
    >
      <div className="wb-form-grid">
          <label className="wb-field wb-span2">
            <span>{t("项目名称")} *</span>
            <input value={values.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className="wb-field">
            <span>{t("模块")}</span>
            <input list="wb-module-options" value={values.module} onChange={(e) => patch({ module: e.target.value })} />
            <datalist id="wb-module-options">
              {[...new Set([...knownModules, values.module])].map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label className="wb-field">
            <span>{t("状态")}</span>
            <select value={values.status} onChange={(e) => patch({ status: e.target.value as ProjectStatus })}>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="wb-field">
            <span>{t("负责人")}</span>
            <input value={values.owner} onChange={(e) => patch({ owner: e.target.value })} />
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
            <input value={tagText} placeholder="示例, 后端" onChange={(e) => setTagText(e.target.value)} />
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
    </DialogShell>
  );
}
