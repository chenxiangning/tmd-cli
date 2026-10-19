/**
 * DayFlow 视图子件:功能卡 / 未归纳日降级列表 / 区间汇总条 / 尾部杂项。
 * 自 DayFlow.tsx 拆出守 300 行与复杂度约束。
 */
import { t } from "@kernel/i18n";
import type { DayFileEntry, FpCardView, FpDayDetail } from "../dataSource";
import { dayTotals } from "../dataSource";
import { EngTag, Hi } from "./bits";

function FeatureCard({ card, inRange, day, query, focused, onOpenCard, onFix }: {
  card: FpCardView;
  day: string;
  inRange: boolean;
  query: string;
  focused: boolean;
  onOpenCard: (c: FpCardView) => void;
  onFix: (c: FpCardView) => void;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-[var(--tmd-bg-panel)] transition-shadow hover:shadow-md ${focused ? "border-[var(--tmd-accent,var(--tmd-accent))] ring-1 ring-[var(--tmd-accent,var(--tmd-accent))]" : "border-[var(--tmd-border,var(--tmd-border))]"}`}
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[var(--tmd-accent,var(--tmd-accent))] opacity-60" />
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
            <span className={`rounded px-1.5 text-[9.5px] font-semibold ${card.unverified ? "border border-dashed border-[var(--tmd-border-strong,var(--tmd-border-strong))] text-[var(--tmd-fg-muted)]" : "bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] text-[var(--tmd-accent,var(--tmd-accent))]"}`}>
              {card.unverified ? t("会话引用未验证") : t("AI 归纳")}
            </span>
            {inRange && <span className="text-[10.5px] text-[var(--tmd-fg-muted)]">{day.slice(5)}</span>}
          </div>
          <div className="mt-1 text-[12.5px] text-[var(--tmd-fg)]">
            <Hi text={card.summary} q={query} />
          </div>
          {card.quote && (
            <div className="mt-1.5 border-l-2 border-[var(--tmd-accent-weak,var(--tmd-accent-soft))] pl-2 text-[12px] text-[var(--tmd-fg)] italic">
              「<Hi text={card.quote.text} q={query} />」
              <span className="ml-1 text-[10.5px] not-italic text-[var(--tmd-fg-muted)]">
                —— {card.quote.time} · {t("用户原话锚点")}
              </span>
            </div>
          )}
        </button>
        <button
          type="button"
          className="flex-none rounded-md bg-[var(--tmd-bg-hover)] px-2 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--tmd-bg-elevated)] focus:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onFix(card);
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

/** 区间汇总条(按天聚合 ±;项目横条按 cwd 顶层目录)。 */
export function RangeBanner({ details }: { details: FpDayDetail[] }) {
  let plus = 0;
  let minus = 0;
  let sess = 0;
  const proj = new Map<string, { plus: number; minus: number }>();
  for (const d of details) {
    const tt = dayTotals(d.rollup);
    plus += tt.plus;
    minus += tt.minus;
    sess += tt.sessions;
    if (!d.rollup) continue;
    for (const [path, stat] of Object.entries(d.rollup.files)) {
      const cwd = stat.refs.map((sid) => d.rollup?.sessions[sid]?.cwd).find(Boolean) ?? "";
      const key = cwd.split("/").filter(Boolean).pop() ?? path.split("/")[0];
      const acc = proj.get(key) ?? { plus: 0, minus: 0 };
      acc.plus += stat.add;
      acc.minus += stat.del;
      proj.set(key, acc);
    }
  }
  const total = Math.max(1, plus + minus);
  const colors = ["var(--tmd-accent)", "var(--tmd-accent)", "var(--tmd-ok)", "#d97757"];
  return (
    <div className="mb-3 rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] p-3">
      <div className="mb-1 text-[11px] font-bold text-[var(--tmd-fg-muted)]">
        {t("区间汇总")} <span className="font-normal">{t("· 点月历任意单日退出区间")}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-[12px]">
        {[...proj.entries()].map(([name, v]) => (
          <span key={name}>
            <b>{name}</b> <span className="text-emerald-600">+{v.plus}</span> <span className="text-red-500">−{v.minus}</span>
          </span>
        ))}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--tmd-bg-hover)]">
        {[...proj.entries()].map(([name, v], i) => (
          <i
            key={name}
            title={`${name} ±${v.plus + v.minus}`}
            style={{ width: `${((v.plus + v.minus) / total * 100).toFixed(1)}%`, background: colors[i % colors.length] }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 text-[11px] text-[var(--tmd-fg-muted)]">
        <span>{t("{n} 天", { n: details.length })}</span>
        <span>{t("{n} 场", { n: sess })}</span>
        <span className="text-emerald-600">+{plus}</span>
        <span className="text-red-500">−{minus}</span>
      </div>
    </div>
  );
}

/** 功能卡流。点卡内容 = 打开证据抽屉;悬停出修正入口。 */
export function CardList({ detail, query, focusIdx, fixCardTitle, onOpenCard, onFix }: {
  detail: FpDayDetail;
  query: string;
  focusIdx: number;
  fixCardTitle: string | null;
  onOpenCard: (c: FpCardView) => void;
  onFix: (c: FpCardView) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      {detail.cards.map((c, i) => (
        <div key={c.title}>
          <FeatureCard
            card={c}
            day={detail.day}
            inRange={false}
            query={query}
            focused={i === focusIdx}
            onOpenCard={onOpenCard}
            onFix={onFix}
          />
          {fixCardTitle === c.title && (
            <div className="ml-1 mt-1 rounded-lg border border-dashed border-[var(--tmd-border-strong,var(--tmd-border-strong))] px-3 py-2 text-[11px] text-[var(--tmd-fg-muted)]">
              {t("重命名 / 标记为无关 / 合并 / 拆分 直接写修正层(.user.json)· 手动补归纳建新卡")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 未归纳日诚实降级块。 */
export function FallbackList({ detail, ungrouped, projOrder, onManualDigest }: {
  detail: FpDayDetail;
  ungrouped: { project: string; path: string; stat: DayFileEntry }[];
  projOrder: string[];
  onManualDigest: () => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] p-3">
      <div className="mb-1 text-[12.5px] font-bold">
        {t("该日无功能归纳")}
        <span className="ml-2 rounded bg-[var(--tmd-bg-hover)] px-1.5 py-px text-[10px] font-normal text-[var(--tmd-fg-muted)]">
          {t("features 文件缺失或生成失败")}
        </span>
        <button
          type="button"
          className="ml-2 rounded-md bg-[var(--tmd-bg-hover)] px-2 py-0.5 text-[11px] hover:bg-[var(--tmd-bg-elevated)]"
          onClick={onManualDigest}
        >
          {t("手动补归纳")}
        </button>
      </div>
      <div className="text-[11px] text-[var(--tmd-fg-muted)]">
        {t("按项目分组诚实罗列,不装作聚了类 · 修正层可手动补归纳")}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {detail.rows.map((r) => (
          <RawRow
            key={`${r.profileId}:${r.id ?? r.title}`}
            left={new Date(r.startedAt).toTimeString().slice(0, 5)}
            tag={r.profileId}
            tagColor="var(--tmd-fg-muted)"
            text={r.title}
          />
        ))}
        {projOrder.map((p) => (
          <div key={p}>
            <div className="mt-1 text-[11px] font-bold text-[var(--tmd-fg)]">{p}</div>
            {ungrouped
              .filter((f) => f.project === p)
              .map((f) => (
                <RawRow
                  key={f.path}
                  left=""
                  tag={t("文件")}
                  tagColor="var(--tmd-fg-subtle)"
                  text={`${f.path}  +${f.stat.add} −${f.stat.del}`}
                  mono
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 日视图尾部:git 硬证据 / 全空态 / 扫描降级提示 / 引擎色标。 */
export function DayTail({ detail, hasFeatures, ungrouped }: {
  detail: FpDayDetail;
  hasFeatures: boolean;
  ungrouped: { project: string; path: string; stat: DayFileEntry }[];
}) {
  return (
    <>
      {detail.commits.length > 0 && (
        <>
          <div className="mb-2 text-[11px] font-bold tracking-wide text-[var(--tmd-fg-muted)]">
            {t("Git 硬证据(提交即权威,不受账本清理影响)")}
          </div>
          <div className="mb-4 rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] px-3 py-2">
            {detail.commits.map((c) => (
              <RawRow key={c.hash} left={c.time.slice(11, 16)} tag="git" tagColor="var(--tmd-fg-muted)" text={`${c.hash} ${c.subject}`} mono />
            ))}
          </div>
        </>
      )}

      {!hasFeatures && detail.rows.length === 0 && ungrouped.length === 0 && detail.commits.length === 0 && (
        <div className="py-10 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">{t("该日无记录")}</div>
      )}

      {detail.scanFailed && (
        <div className="text-[11px] text-amber-600">
          {t("部分引擎会话清单扫描失败,当日会话数可能偏少")}
        </div>
      )}

      {/* 会话引擎色标样例消费:未归纳日行用引擎色(此处取 rollup 元数据渲染) */}
      {detail.rollup && Object.entries(detail.rollup.sessions).length > 0 && !hasFeatures && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {[...new Set(Object.values(detail.rollup.sessions).map((s) => s.engine))].map((e) => (
            <EngTag key={e} engine={e} />
          ))}
        </div>
      )}
    </>
  );
}
