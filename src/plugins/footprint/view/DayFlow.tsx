/**
 * footprint 主流:当日头部 + 汇总条 + 功能卡流 + 未归纳日诚实降级 +
 * git 硬证据区;区间模式下渲染区间汇总 + 按日分组卡流。子件见 DayParts/RangeParts。
 */
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import type { FpCardView, FpDayDetail } from "../dataSource";
import { dayTotals, ungroupedFiles } from "../dataSource";
import { openArticleTab } from "@plugins/workbench/journal/journalTabs";
import { CardList, FeatureCard } from "./DayParts";
import { DayTail, FallbackList, RangeBanner } from "./RangeParts";

export interface DayFlowProps {
  detail: FpDayDetail;
  /** 单日明细在途:居中 Spinner 替代整块内容,避免展示上一日的旧数据。 */
  loading?: boolean;
  /** 区间视图非空时渲染区间汇总而非单日。 */
  range: [string, string] | null;
  rangeDetails: FpDayDetail[];
  query: string;
  today: string;
  /** 卡片焦点索引(j/k 移动;-1 = 无)。 */
  focusIdx: number;
  onOpenCard: (card: FpCardView) => void;
  onFix: (card: FpCardView, rect: DOMRect) => void;
  onManualDigest: () => void;
  /** AI 补归纳:入队工作台日报生成会话(功能卡随文直写)。 */
  onAiDigest: () => void;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 日报首行 → 标题(剥 # 前缀,截 60 字;tab 条与日报行共用)。 */
function articleHeadline(md: string): string {
  const line = md.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.replace(/^#+\s*/, "").slice(0, 60);
}

/** 分区标题(原型 flow-label):左标签 + 右侧通栏横线。 */
function FlowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center gap-2 text-[11px] font-bold tracking-wide whitespace-nowrap text-[var(--tmd-fg-muted)]">
      {children}
      <i className="h-px flex-1 bg-[var(--tmd-border,var(--tmd-border))]" />
    </div>
  );
}

/** 汇总 chip(原型 .chip:面板底 + 描边 + 胶囊)。 */
function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex flex-none items-center gap-1 rounded-full border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] px-2.5 py-0.5 whitespace-nowrap">
      {children}
    </span>
  );
}

/** 区间视图(原型 renderRange):日头 + 汇总 chips + 区间汇总条 + 按日分组卡流。 */
function RangeFlow({ range, details, query, focusIdx, onOpenCard, onFix }: {
  range: [string, string];
  details: FpDayDetail[];
  query: string;
  focusIdx: number;
  onOpenCard: (c: FpCardView) => void;
  onFix: (c: FpCardView, rect: DOMRect) => void;
}) {
  const fmt = (k: string) => t("{m} 月 {d} 日", { m: Number(k.slice(5, 7)), d: Number(k.slice(8, 10)) });
  let plus = 0;
  let minus = 0;
  let sess = 0;
  let cardN = 0;
  for (const d of details) {
    const tt = dayTotals(d.rollup);
    plus += tt.plus;
    minus += tt.minus;
    sess += Math.max(tt.sessions, d.rows.length);
    cardN += d.cards.length;
  }
  let focusOffset = 0;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-[1.625rem] pt-[18px] pb-15">
      <div className="mb-1 flex items-baseline gap-2 whitespace-nowrap">
        <h1 className="text-[17px] font-bold">
          {fmt(range[0])} — {fmt(range[1])}
        </h1>
        <span className="text-[13px] text-[var(--tmd-fg-muted)]">{t("区间视图")}</span>
      </div>
      <div className="mb-4 flex items-center gap-2 text-[11.5px] whitespace-nowrap text-[var(--tmd-fg-muted)]">
        <Chip>
          <b className="text-[var(--tmd-fg)]">{t("{n} 天", { n: details.length })}</b>
        </Chip>
        <Chip>
          <b className="text-[var(--tmd-fg)]">{cardN}</b> {t("项功能")}
        </Chip>
        <Chip>
          <b className="text-emerald-600">+{plus}</b> / <b className="text-red-500">−{minus}</b>
        </Chip>
        <Chip>
          <b className="text-[var(--tmd-fg)]">{sess}</b> {t("场会话")}
        </Chip>
      </div>
      <RangeBanner details={details} />
      <FlowLabel>{t("区间功能卡流(按日分组)")}</FlowLabel>
      {details.map((d) => {
        const start = focusOffset;
        focusOffset += d.cards.length;
        if (d.cards.length === 0) return null;
        return (
          <div key={d.day} className="mb-4 flex flex-col gap-2.5">
            {d.cards.map((c, i) => (
              <FeatureCard
                key={`${d.day}:${i}`}
                card={c}
                day={d.day}
                inRange
                query={query}
                focused={start + i === focusIdx}
                origin={d.cardsOrigin}
                detail={d}
                onOpenCard={onOpenCard}
                onFix={onFix}
              />
            ))}
          </div>
        );
      })}
      {cardN === 0 && <div className="py-10 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">{t("区间内无功能归纳")}</div>}
    </div>
  );
}

export function DayFlow({ detail, range, rangeDetails, query, today, focusIdx, onOpenCard, onFix, onManualDigest, onAiDigest, loading }: DayFlowProps) {
  if (range) {
    return <RangeFlow range={range} details={rangeDetails} query={query} focusIdx={focusIdx} onOpenCard={onOpenCard} onFix={onFix} />;
  }

  if (loading) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 overflow-y-auto px-[1.625rem] text-[12.5px] text-[var(--tmd-fg-muted)]">
        <Spinner />
        {t("加载中…")}
      </div>
    );
  }

  const tt = dayTotals(detail.rollup);
  /* 会话徽标口径:账本(封口事件)与 CLI 扫描取大者 —— 插件部署前的会话无封口账,
   * 只按账本计会出现「列表有会话、徽标 0」的自相矛盾(2026-10-20 大仙真机反馈)。 */
  const sessionCount = Math.max(tt.sessions, detail.rows.length);
  const hasFeatures = detail.cards.length > 0;
  const ungrouped = !hasFeatures && detail.rollup ? ungroupedFiles(detail.rollup) : [];
  const projOrder = [...new Set(ungrouped.map((f) => f.project))];
  const weekday = WEEKDAYS[new Date(`${detail.day}T12:00:00`).getDay()];

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-[1.625rem] pt-[18px] pb-15">
      <div className="mb-1 flex items-baseline gap-2 whitespace-nowrap">
        <h1 className="text-[17px] font-bold">{detail.day}</h1>
        <span className="text-[13px] text-[var(--tmd-fg-muted)]">{t(weekday)}</span>
        {detail.day === today && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold text-[var(--tmd-ok)]" style={{ background: "color-mix(in srgb, var(--tmd-ok) 12%, transparent)" }}>
            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--tmd-ok)]" />
            {t("今日 · 会话进行中")}
          </span>
        )}
      </div>
      <div className="mb-4 flex items-center gap-2 text-[11.5px] whitespace-nowrap text-[var(--tmd-fg-muted)]">
        <Chip>
          <b className="text-[var(--tmd-fg)]">{detail.cards.length}</b> {t("项功能")}
        </Chip>
        <Chip>
          <b className="text-[var(--tmd-fg)]">{sessionCount}</b> {t("场会话")}
        </Chip>
        <Chip
          title={tt.plus + tt.minus === 0 ? t("账本无改动记录:footprint 部署前的会话不产生封口账;此列提交可在下方 Git 硬证据区核对") : undefined}
        >
          <b className="font-mono text-emerald-600">+{tt.plus}</b> / <b className="font-mono text-red-500">−{tt.minus}</b>
        </Chip>
        <span className="min-w-0 flex-1 truncate">{t("证据随点随取:点功能卡看会话 / 文件 / diff")}</span>
      </div>

      {/* 日报行:journal 生成产物在读侧的常驻入口(消费 loadDayDetail.article;
          深链 openArticleTab,spec 2026-10-20 双向深链) */}
      {detail.article && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] px-2.5 py-1.5 text-[11.5px] whitespace-nowrap">
          <span className="flex-none font-semibold text-[var(--tmd-fg)]">{t("日报")}</span>
          <span className="min-w-0 flex-1 truncate text-[var(--tmd-fg-muted)]">{articleHeadline(detail.article)}</span>
          <button
            type="button"
            className="flex-none rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--tmd-fg-muted)] hover:bg-[var(--tmd-bg-hover)] hover:text-[var(--tmd-fg)]"
            onClick={() => {
              const [y, m, d] = detail.day.split("-").map(Number);
              const title = articleHeadline(detail.article ?? "");
              openArticleTab(y, m, d, title || undefined);
            }}
          >
            {t("打开日报 ↗")}
          </button>
        </div>
      )}

      {hasFeatures && (
        <>
          <FlowLabel>{t("功能与任务(AI 归纳 · 悬停可修正)")}</FlowLabel>
          <CardList detail={detail} query={query} focusIdx={focusIdx} onOpenCard={onOpenCard} onFix={onFix} />
        </>
      )}

      {!hasFeatures && (detail.rows.length > 0 || ungrouped.length > 0) && (
        <FallbackList detail={detail} ungrouped={ungrouped} projOrder={projOrder} onManualDigest={onManualDigest} onAiDigest={onAiDigest} />
      )}

      <DayTail detail={detail} hasFeatures={hasFeatures} ungrouped={ungrouped} />
    </div>
  );
}
