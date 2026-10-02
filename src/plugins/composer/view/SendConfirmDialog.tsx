/**
 * 发送二次确认弹层(spec 2026-09-27-composer-send-confirm)。
 *
 * portal + fixed z-1000(GitConfirmDialog 同层级纪律);发送键聚焦,
 * Enter = 确认 / Esc / 点遮罩 = 取消(keyCode 229 兜底同 enterAction 纪律)。
 * 目标区按结构化字段渲染:平铺幕布位序徽标 + 会话标题(与 tab 条同源)+
 * 工作区 · 引擎副行,广播多卡并列 + 计数头,用户据此认出发到哪块幕布。
 * 弹框零状态:req.plan 纯展示,onConfirm/onCancel 闭包由挂起点注入;
 * 弹层焦点圈闭(dialog 语义:打开入确认键、Tab 循环、关闭还原焦点)。
 */

import { t } from "@kernel/i18n";
import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SendConfirmRequest, SendTarget } from "./sendPlan";
import { useFocusTrap } from "@kernel/useFocusTrap";

/* 弹层焦点圈闭(同款见 RelayDialog/SearchOverlay/WorktreeManageDialog/academy
   wizard;候选统一收口进 kernel/DialogShell):req 在挂 = 打开态,Tab 循环 +
   关闭还原焦点(初焦点仍走下方确认键 effect,与既有行为一致)。 */

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
    /* 焦点归还:确认键随弹层卸载后焦点落 body,不归还则下次发送要重点输入框
       (2026-09-27 桩目检实证)。焦点已在 composer 内(点遮罩/取消键路径)不动。 */
    const ta = document.getElementById("composer-textarea");
    if (ta && !ta.contains(document.activeElement)) ta.focus();
    fn();
  };
  /* 确认键聚焦(react-doctor/no-autofocus:编程聚焦替代 autoFocus 字面量) */
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useFocusTrap(req != null, false);
  useEffect(() => {
    if (req) confirmRef.current?.focus();
  }, [req]);
  const { onConfirm, onCancel } = req ?? { onConfirm: () => {}, onCancel: () => {} };
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === 229 || e.repeat) return;
      if (e.key === "Enter") {
        e.preventDefault();
        settle(req.onConfirm);
      } else if (e.key === "Escape") {
        settle(req.onCancel);
      }
    };
    /* 延一宏任务挂载:开框的那记 Enter/⌘Enter 在离散事件同步 commit 下仍在本帧
       冒泡向 window(effect 随 commit 同步 flush),同帧接住 = 开框即自确认,
       二次确认形同虚设(2026-09-27 大仙实测 Enter 直发)。setTimeout(0) 保证
       开框键派发完毕后监听才上线;repeat 闸防长按连发第二记即确认。 */
    const tid = window.setTimeout(() => window.addEventListener("keydown", onKey), 0);
    return () => {
      window.clearTimeout(tid);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, onSettled]);

  if (!req) return null;
  const { plan } = req;
  const broadcast = plan.targets.length > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60"
      onClick={() => settle(onCancel)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("确认发送")}
        className="mx-4 flex w-[26rem] max-w-[92vw] flex-col rounded-lg border border-(--tmd-border) bg-(--tmd-bg-popover) shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--tmd-border) px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-(--tmd-fg)">
            <PaperPlaneRightIcon size="0.875rem" className="text-(--tmd-accent)" aria-hidden />
            {t("确认发送")}
          </div>
          <div className="text-xs text-(--tmd-fg-faint)">{t("Enter 确认 · Esc 取消")}</div>
        </div>
        <div className="px-4 pt-3">
          <div className="text-xs text-(--tmd-fg-faint)">
            {broadcast
              ? t("将发送到 {n} 块幕布:", { n: plan.targets.length })
              : t("发送目标")}
          </div>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {plan.targets.map((tg) => (
              <TargetCard
                key={tg.paneIndex !== undefined ? `p${tg.paneIndex}` : `${tg.title}|${tg.workspace}|${tg.engine}`}
                target={tg}
                multi={broadcast}
              />
            ))}
          </div>
        </div>
        <div className="px-4 pt-3">
          <div className="text-xs text-(--tmd-fg-faint)">{t("内容")}</div>
          <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-(--tmd-border) bg-(--tmd-bg-base) px-2.5 py-2 text-xs leading-4 text-(--tmd-fg-muted)">
            {plan.content}
          </div>
        </div>
        <div className="mt-3.5 flex justify-end gap-1.5 border-t border-(--tmd-border) px-4 py-2.5">
          <button
            onClick={() => settle(onCancel)}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            {t("取消")}
          </button>
          <button
            ref={confirmRef}
            onClick={() => settle(onConfirm)}
            className="flex items-center gap-1 rounded bg-(--tmd-accent) px-2.5 py-1 text-xs text-(--tmd-accent-fg)"
          >
            <PaperPlaneRightIcon size="0.75rem" aria-hidden />
            {t("发送")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 单目标卡:幕布位序徽标(平铺态)+ 标题 + 当前 chip(广播态)+ 工作区 · 引擎副行。 */
function TargetCard({ target, multi }: { target: SendTarget; multi: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded border border-(--tmd-border) bg-(--tmd-bg-base) px-2.5 py-1.5">
      {target.paneIndex !== undefined && (
        <span className="shrink-0 rounded bg-(--tmd-accent-soft) px-1.5 py-0.5 text-meta font-medium text-(--tmd-accent)">
          {t("幕布 {n}", { n: target.paneIndex })}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-(--tmd-fg)">{target.title}</span>
          {multi && target.active && (
            <span className="shrink-0 rounded border border-(--tmd-border) px-1 py-px text-meta text-(--tmd-fg-faint)">
              {t("当前")}
            </span>
          )}
        </div>
        <div className="truncate text-meta text-(--tmd-fg-faint)">
          {target.workspace} · {target.engine}
        </div>
      </div>
    </div>
  );
}
