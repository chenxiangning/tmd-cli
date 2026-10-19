/**
 * footprint 左栏:月历热力格 + 图例 + 当月统计。
 * 原型 v2.1 左 rail:底色档 = 强度分位,shift/右键起点进区间选择。
 */
import { t } from "@kernel/i18n";
import type { HeatCell } from "../dataSource";

/** 热力口径:按改动量 / 按会话数。 */
export type HeatMode = "lines" | "sessions";

/** 热力五档色(弱 → 强;原型 HEAT_SCALE 蓝阶,accent 阶)。
 * 整格不染色,热力走格底 14×3 色条,与 today/sel/区间高亮解耦(原型语义)。 */
const HEAT_SCALE = [
  "var(--tmd-border)",
  "color-mix(in srgb, var(--tmd-accent, #3370ff) 30%, transparent)",
  "color-mix(in srgb, var(--tmd-accent, #3370ff) 50%, transparent)",
  "color-mix(in srgb, var(--tmd-accent, #3370ff) 72%, transparent)",
  "var(--tmd-accent, #3370ff)",
];

const DOW_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export interface MonthCalProps {
  y: number;
  m: number;
  /** 当月热力格(key = "DD";无活动日缺席)。 */
  cells: HeatCell[];
  today: string;
  sel: string;
  /** 区间 [起, 止];null = 单日模式。 */
  range: [string, string] | null;
  heat: HeatMode;
  onSelectDay: (day: string, shift: boolean) => void;
  onAnchorDay: (day: string) => void;
}

function heatValueOf(cell: HeatCell | undefined, mode: HeatMode): number {
  if (!cell) return 0;
  return mode === "lines" ? cell.add + cell.del : cell.sessionCount;
}

export function MonthCal({ y, m, cells, today, sel, range, heat, onSelectDay, onAnchorDay }: MonthCalProps) {
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  const cellByDd = new Map(cells.map((c) => [c.dd, c]));
  const first = new Date(y, m - 1, 1);
  const startDow = (first.getDay() + 6) % 7; /* 周一为 0,与原型列序一致 */
  const dim = new Date(y, m, 0).getDate();
  const prevDim = new Date(y, m - 1, 0).getDate();

  const cellsGrid: { d: number; day: string | null; key: string }[] = [];
  for (let i = 0; i < 42; i++) {
    const n = i - startDow + 1;
    if (n < 1) cellsGrid.push({ d: prevDim + n, day: null, key: `p${prevDim + n}` });
    else if (n > dim) cellsGrid.push({ d: n - dim, day: null, key: `n${n - dim}` });
    else cellsGrid.push({ d: n, day: `${ym}-${String(n).padStart(2, "0")}`, key: `${ym}-${String(n).padStart(2, "0")}` });
  }

  const values = cellsGrid
    .filter((c) => c.day)
    .map((c) => heatValueOf(cellByDd.get(c.day!.slice(8)), heat))
    .filter((v) => v > 0);
  const max = Math.max(1, ...values);

  /* 当月统计条 */
  let statDays = 0;
  let statSess = 0;
  let statPlus = 0;
  let statMinus = 0;
  for (const c of cells) {
    statDays++;
    statSess += c.sessionCount;
    statPlus += c.add;
    statMinus += c.del;
  }

  return (
    <div className="flex h-full flex-col gap-2 px-3">
      <div className="text-[11px] font-bold tracking-wide text-[var(--tmd-fg-muted)]">
        {t("月历")} <span className="font-normal">{t("热力点 = 当日强度")}</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-[var(--tmd-fg-muted)]">
            {d}
          </div>
        ))}
        {cellsGrid.map((c) => {
          if (!c.day) {
            return (
              <div key={c.key} className="flex h-9 items-center justify-center rounded text-[11px] text-[var(--tmd-fg-muted)] opacity-45">
                {c.d}
              </div>
            );
          }
          const day: string = c.day;
          const v = heatValueOf(cellByDd.get(day.slice(8)), heat);
          const tier = v === 0 ? -1 : Math.min(3, Math.floor((v / max) * 4));
          const inRange = range !== null && day >= range[0] && day <= range[1];
          const edge = range !== null && (day === range[0] || day === range[1]);
          const selected = day === sel && range === null;
          /* 分支互斥选定,杜绝同组工具类冲突(边框色/hover 底各归各分支;评审 P0-1/P1-8) */
          let cls: string;
          if (selected) {
            cls = "rounded-md border-[var(--tmd-accent,var(--tmd-accent))] bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] font-bold text-[var(--tmd-accent,var(--tmd-accent))] hover:bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))]";
          } else if (day === today) {
            cls = "rounded-md border-[var(--tmd-accent,var(--tmd-accent))] font-semibold text-[var(--tmd-accent,var(--tmd-accent))] hover:bg-[var(--tmd-bg-hover)]";
          } else if (edge) {
            cls = "rounded-md border-transparent bg-[var(--tmd-accent,var(--tmd-accent))] font-bold text-white hover:bg-[var(--tmd-accent,var(--tmd-accent))]";
          } else if (inRange) {
            cls = "rounded-none border-transparent bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))]";
          } else {
            cls = "rounded-md border-transparent hover:bg-[var(--tmd-bg-hover)]";
          }
          cls = `relative flex h-9 cursor-pointer select-none items-center justify-center border text-[11.5px] transition-colors ${cls}`;
          return (
            <button
              type="button"
              key={day}
              className={cls}
              title={`${day} · ${v > 0 ? (heat === "lines" ? `±${v}` : t("{n} 场", { n: v })) : t("无记录")}`}
              onClick={(e) => onSelectDay(day, e.shiftKey)}
              onContextMenu={(e) => {
                e.preventDefault();
                onAnchorDay(day);
              }}
            >
              {c.d}
              {v > 0 && (
                <span
                  className="absolute bottom-[3px] h-[3px] w-3.5 rounded-full"
                  style={{
                    /* 高亮格随前景反差(edge 白字→白条,sel/区间→文字色);常态走热力档色(评审 P1-9) */
                    background: selected || inRange ? "color-mix(in srgb, currentColor 55%, transparent)" : HEAT_SCALE[tier + 1],
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-[var(--tmd-fg-muted)]">
        {t("弱")}
        {HEAT_SCALE.slice(1).map((c, i) => (
          <i key={i} className="inline-block h-[3px] w-3.5 rounded-full" style={{ background: c }} />
        ))}
        {t("强")}
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-[var(--tmd-border,var(--tmd-border))] pt-2 text-[11.5px]">
        <div className="flex justify-between">
          <span className="text-[var(--tmd-fg-muted)]">{t("活跃天数")}</span>
          <b className="font-medium tabular-nums">{t("{n} 天", { n: statDays })}</b>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--tmd-fg-muted)]">{t("会话")}</span>
          <b className="font-medium tabular-nums">{t("{n} 场", { n: statSess })}</b>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--tmd-fg-muted)]">{t("改动行")}</span>
          <b className="font-mono font-medium tabular-nums">
            <span className="text-emerald-600">+{statPlus}</span> / <span className="text-red-500">−{statMinus}</span>
          </b>
        </div>
      </div>
    </div>
  );
}
