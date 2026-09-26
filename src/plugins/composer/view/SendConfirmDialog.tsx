/**
 * 发送二次确认弹层(spec 2026-09-27-composer-send-confirm)。
 *
 * portal + fixed z-1000(GitConfirmDialog 同层级纪律);发送键 autoFocus,
 * Enter = 确认 / Esc / 点遮罩 = 取消(keyCode 229 兜底同 enterAction 纪律,
 * 确认框无输入框,IME 分支仅为防确认瞬间残留组合事件)。
 * 弹框零状态:req.plan 纯展示,onConfirm/onCancel 闭包由挂起点注入。
 */

import { t } from "@kernel/i18n";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SendConfirmRequest } from "./sendPlan";

export function SendConfirmDialog({
  req,
  onSettled,
}: {
  req: SendConfirmRequest | null;
  /** 落定(确认或取消)时先清挂起态再回调,防执行段再次挂起被本实例覆盖。 */
  onSettled: () => void;
}) {
  const settle = (fn: () => void) => {
    onSettled();
    fn();
  };
  /* 确认键聚焦(react-doctor/no-autofocus:编程聚焦替代 autoFocus 字面量) */
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (req) confirmRef.current?.focus();
  }, [req]);
  const { onConfirm, onCancel } = req ?? { onConfirm: () => {}, onCancel: () => {} };
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        settle(req.onConfirm);
      } else if (e.key === "Escape") {
        settle(req.onCancel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, onSettled]);

  if (!req) return null;
  const plan = req.plan;
  const broadcast = plan.targetLines.length > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60"
      onClick={() => settle(onCancel)}
    >
      <div
        className="mx-4 w-96 rounded-lg border border-(--tmd-border) bg-(--tmd-bg-popover) p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium text-(--tmd-fg)">{t("确认发送")}</div>
        <div className="mt-2">
          <div className="text-[0.6875rem] text-(--tmd-fg-faint)">
            {broadcast
              ? t("将发送到 {n} 块幕布:", { n: plan.targetLines.length })
              : t("发送目标")}
          </div>
          <div className="mt-0.5 text-[0.6875rem] leading-4 text-(--tmd-fg)">
            {plan.targetLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
        <div className="mt-2">
          <div className="text-[0.6875rem] text-(--tmd-fg-faint)">{t("内容")}</div>
          <div className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[0.6875rem] leading-4 text-(--tmd-fg-muted)">
            {plan.content}
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            onClick={() => settle(onCancel)}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            {t("取消")}
          </button>
          <button
            ref={confirmRef}
            onClick={() => settle(onConfirm)}
            className="rounded bg-(--tmd-accent) px-2.5 py-1 text-xs text-(--tmd-accent-fg)"
          >
            {t("发送")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
