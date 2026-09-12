/**
 * 添加工作区弹层 —— 本地目录 tab 内建;来源 tab(如 WSL 发行版)由
 * workspaceOrigins 注册表供给(来源插件启用才有),本组件零来源知识。
 */

import { useState } from "react";
import { pickDirectory } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace } from "@kernel/workspace";
import { useWorkspaceOrigins } from "@kernel/workspaceOrigins";

/** 添加弹层:backdrop 点外关闭(先例 wsl 卡 AddWslWorkspaceDialog)。 */
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
    ...origins.map((o) => ({ id: o.id, label: o.addTab!.label, component: o.addTab!.component })),
  ];
  const activeOrigin = origins.find((o) => o.id === tab);
  const ActiveTab = activeOrigin?.addTab?.component;

  return (
    <div className="wsl-backdrop" role="presentation" onClick={onClose}>
      <dialog open className="wsl-dialog m-0" aria-label={t("添加工作区")} onClick={(e) => e.stopPropagation()}>
        <div className="wsl-dialog-head">
          <span>{t("添加工作区")}</span>
          <button type="button" className="wsl-dialog-x" onClick={onClose} aria-label={t("关闭")}>
            ×
          </button>
        </div>
        {tabs.length > 1 && (
          <div className="wsl-mode-seg" role="tablist" aria-label={t("工作区来源")}>
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
        <div style={{ padding: "10px 0" }}>
          {ActiveTab ? (
            <ActiveTab onAdded={onClose} />
          ) : (
            <>
              <div className="wsl-hint">{t("选择一个本机目录作为工作区根。")}</div>
              {localHint && <div className="wsl-remote-err">{localHint}</div>}
              <div className="wsl-dialog-foot">
                <button type="button" className="wsl-btn primary" onClick={() => void pickLocal()}>
                  {t("选择目录…")}
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
