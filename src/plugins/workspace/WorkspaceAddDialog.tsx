/**
 * 添加工作区弹层 —— 本地目录 tab 内建;来源 tab(如 WSL 发行版)由
 * workspaceOrigins 注册表供给(来源插件启用才有),本组件零来源知识。
 * 骨架走 kernel DialogShell(portal 到 body + 遮罩 + token 配色):旧版内联
 * fixed 背板被侧栏祖先劫持定位,弹窗偏在左栏下角(2026-09-13 修复)。
 */

import { useState } from "react";
import { FolderSimplePlus } from "@phosphor-icons/react";
import { pickDirectory } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace } from "@kernel/workspace";
import { useWorkspaceOrigins } from "@kernel/workspaceOrigins";
import { DialogShell } from "@kernel/DialogShell";

/** 添加弹层:backdrop 点外关闭 + Esc(DialogShell 提供)。 */
export function WorkspaceAddDialog({ onClose }: { onClose: () => void }) {
  const origins = useWorkspaceOrigins().filter((o) => o.addTab);
  const [tab, setTab] = useState<string>("local");
  const [localHint, setLocalHint] = useState<string | null>(null);

  const pickLocal = async () => {
    try {
      const selected = await pickDirectory(t("选择工作区目录"));
      if (typeof selected === "string" && selected) {
        addWorkspace(selected);
        onClose();
      }
    } catch (err) {
      console.warn("workspace: 选择目录失败", err);
      setLocalHint(t("选择目录失败(权限被拒或已取消)。"));
    }
  };

  const tabs = [
    { id: "local", label: t("本地目录") },
    ...origins.map((o) => ({ id: o.id, label: o.addTab!.label })),
  ];
  const ActiveTab = origins.find((o) => o.id === tab)?.addTab?.component;

  return (
    <DialogShell
      title={t("添加工作区")}
      icon={<FolderSimplePlus size="0.875rem" aria-hidden />}
      width={420}
      onClose={onClose}
      footer={
        ActiveTab ? null : (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void pickLocal()}
              className="rounded bg-(--tmd-accent) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90"
            >
              {t("选择目录…")}
            </button>
          </div>
        )
      }
    >
      {tabs.length > 1 && (
        <div className="wsl-mode-seg mt-2" role="tablist" aria-label={t("工作区来源")}>
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              className={tab === tb.id ? "on" : ""}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>
      )}
      {ActiveTab ? (
        <ActiveTab onAdded={onClose} />
      ) : (
        <>
          <div className="wsl-hint">{t("选择一个本机目录作为工作区根。")}</div>
          {localHint && <div className="wsl-remote-err">{localHint}</div>}
        </>
      )}
    </DialogShell>
  );
}
