/**
 * footprint 主流尾段组件:区间汇总横条 / 未归纳日降级列表 / Git 硬证据 / 空态。
 * 自 DayParts 拆出守 300 行铁则;视觉语义对齐 v2 原型。
 */
import { t } from "@kernel/i18n";
import { dayTotals, type DayFileEntry, type FpDayDetail } from "../dataSource";
import { EngTag } from "./bits";
import { RawRow } from "./DayParts";

export function RangeBanner({ details }: { details: FpDayDetail[] }) {
  let plus = 0;
  let minus = 0;
  const proj = new Map<string, { plus: number; minus: number }>();
  for (const d of details) {
    const tt = dayTotals(d.rollup);
    plus += tt.plus;
    minus += tt.minus;
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
  const colors = ["var(--tmd-accent)", "var(--tmd-syntax-tag)", "var(--tmd-ok)", "#d97757"];
  return (
    <div
      className="mb-3 rounded-xl p-3"
      style={{
        background: "color-mix(in srgb, var(--tmd-syntax-tag) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--tmd-syntax-tag) 25%, transparent)",
      }}
    >
      <div className="mb-1 text-[12.5px] font-semibold">
        {t("区间汇总")} <span className="ml-1 font-normal text-[11.5px] text-[var(--tmd-fg-muted)]">{t("· 点月历任意单日退出区间")}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-[12px]">
        {[...proj.entries()].map(([name, v]) => (
          <span key={name}>
            <b>{name}</b> <span className="text-emerald-600">+{v.plus}</span> <span className="text-red-500">−{v.minus}</span>
          </span>
        ))}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        {[...proj.entries()].map(([name, v], i) => (
          <i
            key={name}
            title={`${name} ±${v.plus + v.minus}`}
            style={{ width: `${((v.plus + v.minus) / total * 100).toFixed(1)}%`, background: colors[i % colors.length] }}
          />
        ))}
      </div>
    </div>
  );
}

/** 功能卡流。点卡内容 = 打开证据抽屉;悬停出修正入口。 */
export function FallbackList({ detail, ungrouped, projOrder, onManualDigest }: {
  detail: FpDayDetail;
  ungrouped: { project: string; path: string; stat: DayFileEntry }[];
  projOrder: string[];
  onManualDigest: () => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-dashed border-[var(--tmd-border-strong,var(--tmd-border))] bg-[var(--tmd-bg-panel)] p-3">
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
          <div className="mb-4">
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
        <div className="text-[11px] text-[var(--tmd-warn)]">
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
