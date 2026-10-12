/**
 * 工作台 · 一键关联候选勾选弹层(A1):linkableWorkspaces 只读解析,
 * 点开头目录默认不勾,其余默认勾;确认前在途禁用防重复提交;
 * 部分失败计数随 toast 回报(WorkbenchTab 消费),不再静默吞错。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { FolderSimple } from "@phosphor-icons/react";
import { createProject } from "./store";
import type { Workspace } from "@kernel/workspace";

/** 点开头目录(名称或路径末段以 . 开头)默认不勾,其余默认勾。 */
function isDotEntry(w: Workspace): boolean {
  const base = w.root.split("/").filter(Boolean).pop() ?? w.name;
  return w.name.startsWith(".") || base.startsWith(".");
}

export function LinkWorkspacesDialog({ workspaces, onClose, onToast }: {
  workspaces: readonly Workspace[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() =>
    new Set(workspaces.filter((w) => !isDotEntry(w)).map((w) => w.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allChecked = workspaces.length > 0 && workspaces.every((w) => checked.has(w.id));
  const submit = () => {
    const picked = workspaces.filter((w) => checked.has(w.id));
    if (picked.length === 0 || busy) return;
    setBusy(true);
    void Promise.allSettled(picked.map((w) => createProject({ name: w.name, cwd: w.root }))).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      const ok = results.length - failed;
      onToast(failed > 0
        ? t("已关联 {ok} 个项目,{failed} 条失败", { ok: String(ok), failed: String(failed) })
        : t("已关联:{count} 个项目", { count: String(ok) }));
      onClose();
    });
  };
  return (
    <DialogShell
      title={t("一键关联工作区")}
      icon={null}
      width={520}
      locked={busy}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("关联")}
          confirmDisabled={!busy && checked.size === 0}
          submitting={busy}
          onConfirm={submit}
          onCancel={onClose}
        />
      }
    >
      <div className="wb-fieldform wb-modal-body">
        <label className="wb-linkrow">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={() => setChecked(allChecked ? new Set<string>() : new Set(workspaces.map((w) => w.id)))}
          />
          {t("全选")}
        </label>
        <ul className="wb-link-candidates">
          {workspaces.map((w) => (
            <li key={w.id}>
              <label className="wb-linkrow">
                <input type="checkbox" checked={checked.has(w.id)} onChange={() => toggle(w.id)} />
                <FolderSimple size={14} aria-hidden />
                <span className="wb-link-cand-name">{w.name}</span>
                <span className="wb-link-cand-path" title={w.root}>{w.root}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="wb-muted">{t("勾选的工作区将各建一个项目并绑定目录;点开头的目录默认不勾。")}</p>
      </div>
    </DialogShell>
  );
}
