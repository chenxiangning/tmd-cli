/**
 * 添加工作区浮层 —— 本地目录 tab 内建;来源 tab(如 WSL 发行版)由
 * workspaceOrigins 注册表供给(来源插件启用才有),本组件零来源知识。
 * 锚定入口按钮右侧滑出(portal + fixed,同 session-budget 浮层先例):
 * 居中 modal 离入口太远(2026-09-13 用户验收反馈),透明背板仅承担点外关闭。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cross } from "@phosphor-icons/react";
import { pickDirectory } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace } from "@kernel/workspace";
import { useWorkspaceOrigins } from "@kernel/workspaceOrigins";

/** position = 入口按钮 rect 推出的左上角(index.tsx 锚定并夹取)。 */
export function WorkspaceAddDialog({
  position,
  onClose,
}: {
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const origins = useWorkspaceOrigins().filter((o) => o.addTab);
  const [tab, setTab] = useState<string>("local");
  const [localHint, setLocalHint] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return createPortal(
    <>
      {/* 透明背板:纯点外关闭(同 .wsmenu-backdrop) */}
      <div className="wsmenu-backdrop" role="presentation" onClick={onClose} />
      {/* 原生 dialog 非模态 open(不调 showModal;Esc 走上方 keydown):
          relative + m-0 中和 UA absolute 定位/居中 margin(先例 DialogShell)。 */}
      <dialog
        open
        aria-label={t("添加工作区")}
        className="wsadd-pop relative m-0"
        style={{ left: position.x, top: position.y }}
      >
        <div className="wsadd-head">
          <span>{t("添加工作区")}</span>
          <button type="button" className="wsadd-x" onClick={onClose} aria-label={t("关闭")}>
            <Cross size="0.875rem" aria-hidden />
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
      </dialog>
    </>,
    document.body,
  );
}
