/**
 * 意图画布 · 卡片动作确认气泡(mossx threads ThreadDeleteConfirmBubble 的插件本地
 * 等价物,API 对齐:threadName/title/message/hint/confirmLabel/isDeleting)。
 */

import { t } from "@kernel/i18n";

export type ConfirmBubbleProps = {
  threadName?: string;
  title?: string;
  message: string;
  hint?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmBubble({
  title,
  message,
  hint,
  confirmLabel,
  cancelLabel,
  isDeleting = false,
  onCancel,
  onConfirm,
}: ConfirmBubbleProps) {
  return (
    <div
      className="intent-canvas-confirm-bubble"
      role="dialog"
      aria-label={title ?? t("确认")}
    >
      {title ? <strong>{title}</strong> : null}
      <p>{message}</p>
      {hint ? <small>{hint}</small> : null}
      <div className="intent-canvas-confirm-actions">
        <button type="button" onClick={onCancel} disabled={isDeleting}>
          {cancelLabel ?? t("取消")}
        </button>
        <button
          type="button"
          className="is-danger"
          onClick={onConfirm}
          disabled={isDeleting}
        >
          {confirmLabel ?? t("确认")}
        </button>
      </div>
    </div>
  );
}
