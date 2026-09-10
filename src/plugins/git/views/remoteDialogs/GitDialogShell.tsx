/**
 * GitDialogShell —— 远端操作对话框共享骨架(portal + 遮罩 + 标题行 + 底部动作区)。
 * 提交中禁关(backdrop 点击/Esc 忽略);宽度按对话框传入(推送宽,拉取/获取窄)。
 * DialogActions 是 取消/主按钮 的固定排法:主按钮 accent,提交中文案切「加载中…」。
 */

import { t } from "@kernel/i18n";
import { useEffect, useEffectEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function GitDialogShell({
  title,
  icon,
  repoName,
  width = 560,
  locked,
  onClose,
  children,
  footer,
}: {
  title: string;
  icon: ReactNode;
  /** 当前操作仓目录名;多仓语境显示(标题行右缘),单仓缺省不显示 */
  repoName?: string;
  width?: number;
  /** 提交中:遮罩点击与 Esc 不再关闭 */
  locked?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  /* Esc 关闭(locked 时忽略);onClose 包 useEffectEvent:父层每轮重建回调
     不该触发重订阅,effect 内永远读最新引用。 */
  const onEscClose = useEffectEvent(() => onClose());
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  /* 自制弹层换原生 dialog(非模态 open,不调 showModal,保留原 Esc/点背板关闭):
     两段式 —— 外层 role=presentation 遮罩 div 承担点背板关闭(target===currentTarget
     判定,a11y 规则认可的 backdrop-dismiss 写法),内层 <dialog> 卡片无鼠标处理器;
     relative + m-0 + max-w/h-none 中和 UA 的 absolute 定位/居中 margin/最大尺寸;
     原手写 role=dialog/aria-modal 删除(原生隐含)。 */
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-1000 flex items-start justify-center overflow-auto bg-black/60 p-6"
      onClick={(e) => {
        if (locked) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        aria-label={title}
        style={{ width }}
        className="relative m-0 h-fit max-h-none max-w-[calc(100vw-48px)] rounded-lg border border-(--tmd-border) bg-(--tmd-bg-popover) p-4 text-left text-(--tmd-fg) shadow-2xl"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-(--tmd-fg)">
          {icon}
          {title}
          {repoName && <span className="git-dialog-repo" title={t("当前仓库:{repoName}", { repoName })}>{repoName}</span>}
        </div>
        {children}
        {footer}
      </dialog>
    </div>,
    document.body,
  );
}

export function DialogActions({
  confirmLabel,
  confirmTitle,
  confirmDisabled,
  submitting,
  onConfirm,
  onCancel,
}: {
  confirmLabel: string;
  confirmTitle?: string;
  confirmDisabled?: boolean;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="rounded border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
      >
        {t("取消")}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled || submitting}
        title={confirmTitle}
        className="rounded bg-(--tmd-accent) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? t("加载中…") : confirmLabel}
      </button>
    </div>
  );
}

/** 选项开关行(codemoss push-footer / gerrit 开关样式:✓ 指示器 + 图标 + 文案)。 */
export function OpToggle({
  active,
  icon,
  label,
  disabled,
  onToggle,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs disabled:opacity-50 ${
        active
          ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
          : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[0.625rem] leading-none ${
          active
            ? "border-(--tmd-accent) bg-(--tmd-accent) text-(--tmd-accent-fg)"
            : "border-(--tmd-border)"
        }`}
      >
        {active ? "✓" : ""}
      </span>
      {icon}
      {label}
    </button>
  );
}
