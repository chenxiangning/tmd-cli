/**
 * 添加工作区浮层 —— 来源卡片两步形态:入口步 = 本地目录卡(点击直达系统
 * picker)+ 各来源注册卡;来源卡进入第二步(返回键 + 来源 addTab 组件)。
 * 来源卡由 workspaceOrigins 注册表供给(来源插件启用才有),本组件零来源知识。
 * 锚定入口按钮右侧滑出(portal + fixed,同 session-budget 浮层先例):
 * 居中 modal 离入口太远(2026-09-13 用户验收反馈),透明背板仅承担点外关闭。
 * 样式:workspace-add.css(wsadd-* 自有类,不借来源插件类 —— review P2 收口)。
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  CaretLeft,
  CaretRight,
  Cross,
  FolderOpen,
  FolderSimplePlus,
} from "@phosphor-icons/react";
import { useEscClose } from "@kernel/DialogShell";
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
  /* null = 入口步(来源卡);来源 id = 第二步(该来源 addTab)。 */
  const [originId, setOriginId] = useState<string | null>(null);
  const [localHint, setLocalHint] = useState<string | null>(null);

  useEscClose(onClose);

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

  const activeOrigin = origins.find((o) => o.id === originId);
  const ActiveTab = activeOrigin?.addTab?.component;

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
        {ActiveTab && activeOrigin ? (
          <>
            <div className="wsadd-step-head">
              <button
                type="button"
                className="wsadd-back"
                onClick={() => setOriginId(null)}
              >
                <CaretLeft size="0.75rem" aria-hidden />
                {t("返回来源")}
              </button>
              <span className="wsadd-step-title">{activeOrigin.addTab!.label}</span>
            </div>
            <ActiveTab onAdded={onClose} />
          </>
        ) : (
          <>
            <div className="wsadd-head">
              <FolderSimplePlus size="0.9375rem" className="wsadd-head-ico" aria-hidden />
              <span>{t("添加工作区")}</span>
              <button type="button" className="wsadd-x" onClick={onClose} aria-label={t("关闭")}>
                <Cross size="0.875rem" aria-hidden />
              </button>
            </div>
            {/* 本地卡:整卡即动作,直达系统目录选择器(零表单步骤)。 */}
            <button type="button" className="wsadd-card" onClick={() => void pickLocal()}>
              <span className="wsadd-card-glyph">
                <FolderOpen size="1.125rem" aria-hidden />
              </span>
              <span className="wsadd-card-txt">
                <span className="wsadd-card-tt">{t("本地目录")}</span>
                <span className="wsadd-card-dd">{t("选择一个本机目录作为工作区根。")}</span>
              </span>
              <CaretRight size="0.75rem" className="wsadd-card-caret" aria-hidden />
            </button>
            {origins.map((o) => {
              const tab = o.addTab!;
              const Icon = tab.icon ?? FolderOpen;
              return (
                <button
                  key={o.id}
                  type="button"
                  className="wsadd-card"
                  onClick={() => setOriginId(o.id)}
                >
                  <span className="wsadd-card-glyph">
                    <Icon size="1.125rem" aria-hidden />
                  </span>
                  <span className="wsadd-card-txt">
                    <span className="wsadd-card-tt">{tab.label}</span>
                    {tab.desc && <span className="wsadd-card-dd">{tab.desc}</span>}
                  </span>
                  <CaretRight size="0.75rem" className="wsadd-card-caret" aria-hidden />
                </button>
              );
            })}
            {localHint && <div className="wsadd-err">{localHint}</div>}
          </>
        )}
      </dialog>
    </>,
    document.body,
  );
}
