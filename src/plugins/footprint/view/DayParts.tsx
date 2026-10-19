/**
 * DayFlow 视图子件:功能卡 / 未归纳日降级列表 / 区间汇总条 / 尾部杂项。
 * 自 DayFlow.tsx 拆出守 300 行与复杂度约束。
 */
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail } from "../dataSource";
import { Hi, IcoChat, IcoFiles } from "./bits";
import { engineColor } from "./engineColor";

function cardStats(detail: FpDayDetail | null, card: FpCardView): { engs: string[]; files: number; plus: number; minus: number } {
  const sids = new Set(card.sessions);
  const engs = [
    ...new Set(card.sessions.map((s) => detail?.rollup?.sessions[s]?.engine).filter((e): e is string => !!e)),
  ];
  let files = 0;
  let plus = 0;
  let minus = 0;
  for (const f of Object.values(detail?.rollup?.files ?? {})) {
    if (!f.refs.some((r) => sids.has(r))) continue;
    files += 1;
    plus += f.add;
    minus += f.del;
  }
  return { engs, files, plus, minus };
}

export function FeatureCard({ card, inRange, day, query, focused, origin, detail, onOpenCard, onFix }: {
  card: FpCardView;
  origin: "ai" | "user-edited" | "manual" | null;
  detail: FpDayDetail | null;
  day: string;
  inRange: boolean;
  query: string;
  focused: boolean;
  onOpenCard: (c: FpCardView) => void;
  onFix: (c: FpCardView, rect: DOMRect) => void;
}) {
  const stats = cardStats(detail, card);
  const manual = origin === "manual" || origin === "user-edited";
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-[var(--tmd-bg-panel)] transition-all hover:-translate-y-px hover:border-[var(--tmd-border-strong,var(--tmd-border))] hover:shadow-md ${focused ? "border-[var(--tmd-accent,var(--tmd-accent))] ring-1 ring-[var(--tmd-accent,var(--tmd-accent))]" : "border-[var(--tmd-border,var(--tmd-border))]"}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${manual ? "bg-[var(--tmd-warn)]" : "bg-[var(--tmd-accent,var(--tmd-accent))]"}`} />
      <div className="flex items-start gap-2 py-3 pr-2 pl-4">
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer text-left"
          onClick={() => onOpenCard(card)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-bold">
              <Hi text={card.title} q={query} />
            </span>
            <span className={`rounded px-1.5 text-[9.5px] font-semibold ${card.unverified ? "border border-dashed border-[var(--tmd-border-strong,var(--tmd-border-strong))] text-[var(--tmd-fg-muted)]" : manual ? "bg-[color-mix(in_srgb,var(--tmd-warn)_12%,transparent)] text-[var(--tmd-warn)]" : "bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] text-[var(--tmd-accent,var(--tmd-accent))]"}`}>
              {card.unverified
                ? t("会话引用未验证")
                : origin === "manual"
                  ? t("手动")
                  : origin === "user-edited"
                    ? t("已修正")
                    : t("AI 归纳")}
            </span>
            {inRange && (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--tmd-syntax-tag)_12%,transparent)] px-2 py-px text-[10.5px] font-semibold text-[var(--tmd-syntax-tag)]">
                {t("{m} 月 {d} 日", { m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) })}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12.5px] text-[var(--tmd-fg)]">
            <Hi text={card.summary} q={query} />
          </div>
          {card.quote && (
            <div className="mt-1.5 rounded-r-lg border-l-[3px] border-[var(--tmd-border-strong,var(--tmd-border))] bg-[var(--tmd-bg-hover)] py-1.5 pl-2.5 text-[12px] text-[var(--tmd-fg)] italic">
              「<Hi text={card.quote.text} q={query} />」
              <span className="mt-0.5 block font-mono text-[10.5px] not-italic text-[var(--tmd-fg-muted)]">
                —— {card.quote.time} · {t("用户原话锚点")}
              </span>
            </div>
          )}
          {/* 卡面 meta(原型 fcard-meta):引擎点堆叠 + 会话/文件数 + ±;rollup 空账时诚实 0 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--tmd-fg-muted)]">
            <span className="flex items-center -space-x-1">
              {stats.engs.slice(0, 4).map((e) => (
                <i
                  key={e}
                  title={e}
                  className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--tmd-bg-panel)] text-[8px] font-bold text-white"
                  style={{ background: engineColor(e) }}
                >
                  {e[0].toUpperCase()}
                </i>
              ))}
            </span>
            <span className="inline-flex items-center gap-1">
              <IcoChat />
              {card.sessions.length} {t("场会话")}
            </span>
            <span className="inline-flex items-center gap-1">
              <IcoFiles />
              {stats.files} {t("文件")}
            </span>
            <span className="text-[var(--tmd-ok)]">+{stats.plus}</span>
            <span className="text-[var(--tmd-err)]">−{stats.minus}</span>
          </div>
        </button>
        <button
          type="button"
          className="flex-none rounded-md bg-[var(--tmd-bg-hover)] px-2 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--tmd-bg-elevated)] focus:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onFix(card, e.currentTarget.getBoundingClientRect());
          }}
        >
          {t("修正")} ▾
        </button>
      </div>
    </div>
  );
}

export function RawRow({ left, tag, tagColor, text, mono }: { left: string; tag: string; tagColor: string; text: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[12px]">
      <span className="flex-none font-mono text-[10.5px] text-[var(--tmd-fg-muted)]">{left}</span>
      <span className="flex-none rounded px-1.5 py-px text-[10px] font-semibold text-white" style={{ background: tagColor }}>
        {tag}
      </span>
      <span className={`min-w-0 flex-1 truncate ${mono ? "font-mono text-[11.5px]" : ""}`}>{text}</span>
    </div>
  );
}

/** 功能卡流。点卡内容 = 打开证据抽屉;悬停出修正入口。 */
export function CardList({ detail, query, focusIdx, onOpenCard, onFix }: {
  detail: FpDayDetail;
  query: string;
  focusIdx: number;
  onOpenCard: (c: FpCardView) => void;
  onFix: (c: FpCardView, rect: DOMRect) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      {detail.cards.map((c, i) => (
        <FeatureCard
          key={`${detail.day}:${i}`}
          card={c}
          day={detail.day}
          inRange={false}
          query={query}
          focused={i === focusIdx}
          origin={detail.cardsOrigin}
          detail={detail}
          onOpenCard={onOpenCard}
          onFix={onFix}
        />
      ))}
    </div>
  );
}

/** 未归纳日诚实降级块。 */
