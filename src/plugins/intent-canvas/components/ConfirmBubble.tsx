/**
 * 意图画布 · 卡片动作确认气泡(mossx threads ThreadDeleteConfirmBubble 的插件本地
 * 等价物,API 对齐:threadName/title/message/hint/confirmLabel/isDeleting)。
 */

import { t } from "@kernel/i18n";

export type ConfirmBubbleProps = {
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
    // eslint-disable-next-line react-doctor/prefer-html-dialog -- 自定义受控弹层,样式/定位经调优;原生 dialog showModal 改焦点行为,mossx 移植不动
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
