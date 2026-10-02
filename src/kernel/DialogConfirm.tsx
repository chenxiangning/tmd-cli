/**
 * ConfirmDialog / InputDialog ── 原生弹窗清零轮(2026-10-02)的通用替换形制:
 *  - ConfirmDialog:window.confirm → 仓内二次确认弹层(danger 红底主钮);
 *  - InputDialog:window.prompt → 单字段输入弹层(Enter 提交/校验行内红字)。
 *  骨架复用 DialogShell(Esc/点背板取消、提交中文案切换);确认词默认「确认」
 *  为全仓统一口径(spec 2026-10-02 R4)。
 */

import { t } from "@kernel/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DialogShell } from "@kernel/DialogShell";

/** ConfirmDialog ── 通用二次确认弹层(2026-10-02 原生 window.confirm 清零轮立):
 *  danger=true 时主按钮红底;Esc/点背板取消;确认词默认「确认」为全仓统一口径。
 *  消费面:ssh/workspace/assets/local-loader/daily-journal/cli-config 等插件的
 *  破坏性操作前置确认(原生 window.confirm 的替换目标形制)。 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  icon,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  /** 默认「确认」;动词型(删除/断开/重置)由调用方传入 */
  confirmLabel?: string;
  danger?: boolean;
  icon?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  /* 编程聚焦替代 autoFocus(react-doctor no-autofocus):danger 聚焦取消钮
     (安全默认,structured 审批卡先例),普通确认聚焦确认钮。 */
  const safeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (danger ? safeRef.current : confirmRef.current)?.focus();
  }, [danger]);
  return (
    <DialogShell
      title={title}
      icon={icon ?? <span aria-hidden>⚠</span>}
      width={400}
      onClose={onClose}
      footer={
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            ref={safeRef}
            onClick={onClose}
            className="rounded border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`rounded px-3 py-1.5 text-xs hover:opacity-90 ${
              /* R5:text-white 全改 accent-fg(err 底同为实色前景档) */
              danger
                ? "bg-(--tmd-err) text-(--tmd-accent-fg)"
                : "bg-(--tmd-accent) text-(--tmd-accent-fg)"
            }`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel ?? t("确认")}
          </button>
        </div>
      }
    >
      <div className="mt-2 text-xs leading-relaxed text-(--tmd-fg-muted)">
        {message}
      </div>
    </DialogShell>
  );
}

/** InputDialog ── 通用单字段输入弹层(原生 window.prompt 的替换目标形制):
 *  form 包裹 Enter 提交;空值或 validate 不过时确认钮置灰,错误行内红字;
 *  Esc/点背板取消。 */
export function InputDialog({
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel,
  maxLength,
  validate,
  icon,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** 返回错误文案时禁提交并作行内红字;false/undefined 仅禁提交 */
  validate?: (value: string) => string | false | undefined;
  icon?: ReactNode;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  /* 编程聚焦替代 autoFocus(react-doctor no-autofocus)。 */
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const error = validate?.(value.trim());
  const disabled = value.trim().length === 0 || Boolean(error);
  return (
    <DialogShell
      title={title}
      icon={icon ?? <span aria-hidden>✎</span>}
      width={400}
      onClose={onClose}
      footer={
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            {t("取消")}
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="rounded bg-(--tmd-accent) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:opacity-50"
          >
            {confirmLabel ?? t("确认")}
          </button>
        </div>
      }
    >
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          onSubmit(value.trim());
          onClose();
        }}
      >
        <label className="block text-xs text-(--tmd-fg-muted)">
          {label}
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={Boolean(error) || undefined}
            className="mt-1 w-full rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1.5 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-(--tmd-err)">
            {error}
          </p>
        ) : null}
      </form>
    </DialogShell>
  );
}
