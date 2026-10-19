/**
 * footprint 主流:当日头部 + 汇总条 + 功能卡流 + 未归纳日诚实降级 +
 * git 硬证据区;区间模式下渲染区间汇总。子件见 DayParts.tsx。
 */
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail } from "../dataSource";
import { dayTotals, ungroupedFiles } from "../dataSource";
import { CardList } from "./DayParts";
import { DayTail, FallbackList, RangeBanner } from "./RangeParts";

export interface DayFlowProps {
  detail: FpDayDetail;
  /** 区间视图非空时渲染区间汇总而非单日。 */
  range: [string, string] | null;
  rangeDetails: FpDayDetail[];
  query: string;
  today: string;
  /** 卡片焦点索引(j/k 移动;-1 = 无)。 */
  focusIdx: number;
  fixCardTitle: string | null;
  onOpenCard: (card: FpCardView) => void;
  onFix: (card: FpCardView) => void;
  onManualDigest: () => void;
}

export function DayFlow({ detail, range, rangeDetails, query, today, focusIdx, fixCardTitle, onOpenCard, onFix, onManualDigest }: DayFlowProps) {
  if (range) return <div className="flex-1 overflow-y-auto px-4 pt-4"><RangeBanner details={rangeDetails} /></div>;

  const tt = dayTotals(detail.rollup);
  /* 会话徽标口径:账本(封口事件)与 CLI 扫描取大者 —— 插件部署前的会话无封口账,
   * 只按账本计会出现「列表有会话、徽标 0」的自相矛盾(2026-10-20 大仙真机反馈)。 */
  const sessionCount = Math.max(tt.sessions, detail.rows.length);
  const hasFeatures = detail.cards.length > 0;
  const ungrouped = !hasFeatures && detail.rollup ? ungroupedFiles(detail.rollup) : [];
  const projOrder = [...new Set(ungrouped.map((f) => f.project))];

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-4 pt-4 pb-8">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-[17px] font-bold">{detail.day}</h1>
        {detail.day === today && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] px-2 py-px text-[10.5px] font-semibold text-[var(--tmd-accent,var(--tmd-accent))]">
            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--tmd-accent,var(--tmd-accent))]" />
            {t("今日 · 会话进行中")}
          </span>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--tmd-fg-muted)]">
        <span className="rounded-full bg-[var(--tmd-bg-hover)] px-2 py-0.5">
          <b className="text-[var(--tmd-fg,var(--tmd-fg))]">{detail.cards.length}</b> {t("项功能")}
        </span>
        <span className="rounded-full bg-[var(--tmd-bg-hover)] px-2 py-0.5">
          <b className="text-[var(--tmd-fg,var(--tmd-fg))]">{sessionCount}</b> {t("场会话")}
        </span>
        <span
          className="rounded-full bg-[var(--tmd-bg-hover)] px-2 py-0.5 font-mono"
          title={tt.plus + tt.minus === 0 ? t("账本无改动记录:footprint 部署前的会话不产生封口账;此列提交可在下方 Git 硬证据区核对") : undefined}
        >
          <b className="text-emerald-600">+{tt.plus}</b> / <b className="text-red-500">−{tt.minus}</b>
        </span>
        <span>{t("证据随点随取:点功能卡看会话 / 文件 / diff")}</span>
      </div>

      {hasFeatures && (
        <>
          <div className="mb-2 text-[11px] font-bold tracking-wide text-[var(--tmd-fg-muted)]">
            {t("功能与任务(AI 归纳 · 悬停可修正)")}
          </div>
          <CardList detail={detail} query={query} focusIdx={focusIdx} fixCardTitle={fixCardTitle} onOpenCard={onOpenCard} onFix={onFix} />
        </>
      )}

      {!hasFeatures && (detail.rows.length > 0 || ungrouped.length > 0) && (
        <FallbackList detail={detail} ungrouped={ungrouped} projOrder={projOrder} onManualDigest={onManualDigest} />
      )}

      <DayTail detail={detail} hasFeatures={hasFeatures} ungrouped={ungrouped} />
    </div>
  );
}
