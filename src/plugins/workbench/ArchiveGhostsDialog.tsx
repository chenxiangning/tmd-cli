/**
 * 工作台 · 空壳批量归档确认弹层(042 债批):逐行列名,默认全勾可反勾,
 * 确认后批量软归档(不删实体,项目列表底可恢复);判据 = 概览同源的
 * pulsePartition().ghosts,由调用方传入。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { Archive } from "@phosphor-icons/react";
import { archiveProjects } from "./store";
import { runIpc } from "./ipcToast";
import type { Project } from "./types";

export function ArchiveGhostsDialog({ ghosts, onClose, onToast }: {
  ghosts: readonly Project[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(ghosts.map((g) => g.id)));
  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const submit = () => {
    const picked = ghosts.filter((g) => checked.has(g.id));
    if (picked.length === 0) return;
    void runIpc(archiveProjects(picked.map((g) => g.id)), onToast, t("已归档 {count} 个项目,可在项目列表底「已归档」中恢复。", { count: picked.length })).then(onClose);
  };
  return (
    <DialogShell
      title={t("归档空壳项目")}
      icon={<Archive size={16} aria-hidden />}
      width={520}
      onClose={onClose}
      footer={<DialogActions confirmLabel={t("归档")} confirmDisabled={checked.size === 0} onConfirm={submit} onCancel={onClose} />}
    >
      <div className="wb-fieldform wb-modal-body">
        <p className="wb-muted">
          {t("以下项目无未完成任务、无截止日期、近 7 天无活动。归档后退出全部统计与列表,不删除任何数据。")}
        </p>
        <ul className="wb-link-candidates">
          {ghosts.map((g) => (
            <li key={g.id}>
              <label className="wb-linkrow">
                <input type="checkbox" checked={checked.has(g.id)} onChange={() => toggle(g.id)} />
                <span className="wb-link-cand-name">{g.name}</span>
                {g.cwd ? <span className="wb-link-cand-path" title={g.cwd}>{g.cwd}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </DialogShell>
  );
}
