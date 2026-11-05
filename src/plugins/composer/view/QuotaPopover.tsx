/**
 * 额度详情弹窗(自 QuotaChip.tsx 拆出守 300 行铁则)── 点击 QuotaChip 弹出。
 * 每个窗口一行:标签 + 进度条 + 已用百分比,下一行给下次刷新时间(绝对 + 相对)。
 * 底部:最近抓取时刻 + 手动刷新按钮。portal 挂 document.body(fixed 定位,
 * 跳出 composer 层叠上下文,杜绝被幕布压住)。
 */
import { createPortal } from "react-dom";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useEscClose } from "@kernel/DialogShell";
import { t } from "@kernel/i18n";
import type { QuotaSnapshot } from "@kernel/quota";
import { formatRelativeTime, formatResetAt } from "@kernel/relativeTime";
import { useMinSpin } from "@kernel/useMinSpin";

/** ms epoch → "14:30:05"(弹窗底部"更新于")。 */
function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function QuotaDetailPopover({
  snapshot,
  loading,
  fetchedAt,
  position,
  onRefresh,
  onClose,
}: {
  snapshot: QuotaSnapshot;
  loading: boolean;
  fetchedAt: number | null;
  position: { x: number; bottom: number };
  onRefresh: () => void;
  onClose: () => void;
}) {
  useEscClose(onClose);
  const { spinning, spin } = useMinSpin();

  return createPortal(
    <>
      <div className="panel-overflow-backdrop" role="presentation" onClick={onClose} />
      <dialog
        open
        /* 自制弹层换原生 dialog(非模态 open,不调 showModal);m-0 中和 UA 居中边距。
           padding/背景/边框由 .quota-popover 自管,类选择器压过 UA 元素默认样式。 */
        className="quota-popover m-0"
        data-icon-decor="dialog"
        style={{ left: position.x, bottom: position.bottom }}
        aria-label={t(snapshot.title)}
      >
        <div className="quota-popover-header">
          <span>{t(snapshot.title)}</span>
          {snapshot.planLabel ? (
            <span className="quota-popover-plan">{t(snapshot.planLabel)}</span>
          ) : null}
        </div>

        {snapshot.windows.map((w) => (
          <div key={w.label} className="quota-popover-window">
            <div className="quota-popover-window-head">
              <span className="quota-popover-window-label">{t(w.label)}</span>
              <span className="quota-popover-bar">
                <span
                  className="quota-popover-fill"
                  style={{ width: `${w.displayPercent}%` }}
                />
              </span>
              <span className="quota-popover-pct">
                {t(snapshot.usedLabel)} {w.displayPercent}%
              </span>
            </div>
            {w.resetsAt ? (
              <div className="quota-popover-reset">
                {t("下次刷新: {abs} · {rel}", { abs: formatResetAt(w.resetsAt), rel: formatRelativeTime(w.resetsAt) })}
              </div>
            ) : null}
          </div>
        ))}

        {snapshot.balanceText ? (
          <div className="quota-popover-balance">{t("余额: {amount}", { amount: snapshot.balanceText })}</div>
        ) : null}

        {snapshot.error ? (
          <div className="quota-popover-error">{snapshot.error}</div>
        ) : null}

        <div className="quota-popover-footer">
          <span>{fetchedAt ? t("更新于 {time}", { time: formatClock(fetchedAt) }) : t("尚未加载")}</span>
          <button
            type="button"
            className="quota-popover-refresh"
            onClick={() => spin(onRefresh)}
            title={t("重新抓取额度")}
           >
             <ArrowClockwise size="0.75rem" aria-hidden className={loading || spinning ? "is-spinning" : undefined} />
            {t("刷新")}
          </button>
        </div>
      </dialog>
    </>,
    document.body,
  );
}
