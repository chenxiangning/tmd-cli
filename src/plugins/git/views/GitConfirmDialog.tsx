/**
 * git 操作二次确认弹层 —— window.confirm 在 Tauri WKWebView 下不可靠
 * (可能不弹窗直接返回,破坏性操作等于裸奔),改用应用内 modal:
 * portal + fixed z-1000(对齐 checkpoints PromptImages 的层级纪律)。
 * Enter(按钮 autoFocus)/ Esc / 点遮罩 = 确认 / 取消 / 取消。
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface GitConfirmState {
  title: string;
  detail?: string;
  confirmLabel?: string;
  /** 危险动作(删除/放弃改动)= 红色确认键 */
  danger?: boolean;
  /** 次选路径(如「暂存并切换」):与主动作并列的另一条执行路径 */
  alt?: { label: string; onConfirm: () => void };
  onConfirm: () => void;
}

export function GitConfirmDialog({
  state,
  onClose,
}: {
  state: GitConfirmState;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="mx-4 w-80 rounded-lg border border-(--tmd-border) bg-(--tmd-bg-popover) p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium text-(--tmd-fg)">{state.title}</div>
        {state.detail && (
          <div className="mt-1 text-[11px] leading-4 text-(--tmd-fg-muted)">{state.detail}</div>
        )}
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            取消
          </button>
          {state.alt && (
            <button
              type="button"
              onClick={() => {
                onClose();
                state.alt?.onConfirm();
              }}
              className="rounded border border-(--tmd-accent) px-2.5 py-1 text-xs text-(--tmd-accent) hover:bg-(--tmd-accent-soft)"
            >
              {state.alt.label}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => {
              onClose();
              state.onConfirm();
            }}
            className={`rounded px-2.5 py-1 text-xs ${
              state.danger
                ? "bg-(--tmd-diff-removed) text-white"
                : "bg-(--tmd-accent) text-(--tmd-accent-fg)"
            }`}
          >
            {state.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
