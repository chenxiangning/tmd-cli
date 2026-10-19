/**
 * footprint 左栏:月历热力格 + 图例 + 当月统计。
 * 原型 v2.1 左 rail:底色档 = 强度分位,shift/右键起点进区间选择。
 */
import { t } from "@kernel/i18n";
import type { HeatCell } from "../dataSource";

/** 热力口径:按改动量 / 按会话数。 */
export type HeatMode = "lines" | "sessions";

/** 热力五档色(弱 → 强;原型 HEAT_SCALE)。 */
const HEAT_SCALE = ["#dfe3ea", "#c7dbff", "#8fb8ff", "#4f8dff", "#1f6bff"];

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
    <div className="flex flex-col gap-2 px-3">
      <div className="text-[11px] font-bold tracking-wide text-[var(--tmd-fg-3,#64748b)]">
        {t("月历")} <span className="font-normal">{t("热力点 = 当日强度")}</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] text-[var(--tmd-fg-3,#94a3b8)]">
            {d}
          </div>
        ))}
        {cellsGrid.map((c) => {
          if (!c.day) {
            return (
              <div key={c.key} className="flex h-9 items-center justify-center rounded text-[11px] text-[var(--tmd-fg-3,#cbd5e1)]">
                {c.d}
              </div>
            );
          }
          const day: string = c.day;
          const v = heatValueOf(cellByDd.get(day.slice(8)), heat);
          const tier = v === 0 ? -1 : Math.min(3, Math.floor((v / max) * 4));
          const inRange = range !== null && day >= range[0] && day <= range[1];
          const edge = range !== null && (day === range[0] || day === range[1]);
          const cls = [
            "relative flex h-9 cursor-pointer select-none items-center justify-center rounded-md border-0 p-0 text-[11.5px] transition-colors hover:ring-1 hover:ring-[var(--tmd-accent,#2563eb)]",
            day === today && "ring-1 ring-[var(--tmd-accent,#2563eb)]",
            day === sel && range === null && "bg-[var(--tmd-accent-weak,#dbe7ff)] font-bold text-[var(--tmd-accent,#1d4ed8)]",
            inRange && "bg-[var(--tmd-surface-2,#f1f5f9)]",
            edge && "bg-[var(--tmd-accent-weak,#dbe7ff)] font-bold",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={day}
              className={cls}
              style={tier >= 0 && day !== sel && !inRange ? { background: HEAT_SCALE[tier + 1] } : undefined}
              title={`${day} · ${v > 0 ? (heat === "lines" ? `±${v}` : t("{n} 场", { n: v })) : t("无记录")}`}
              onClick={(e) => (e.shiftKey ? onAnchorDay(day) : onSelectDay(day, e.shiftKey))}
              onContextMenu={(e) => {
                e.preventDefault();
                onAnchorDay(day);
              }}
            >
              {c.d}
              {v > 0 && (
                <span
                  className="absolute right-1 bottom-0.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: HEAT_SCALE[Math.min(4, tier + 1)] }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-[var(--tmd-fg-3,#94a3b8)]">
        {t("弱")}
        {HEAT_SCALE.slice(1).map((c) => (
          <i key={c} className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: c }} />
        ))}
        {t("强")}
      </div>
      <div className="mt-1 flex flex-col gap-1 rounded-lg bg-[var(--tmd-surface-2,#f8fafc)] p-2 text-[11.5px]">
        <div className="flex justify-between">
          <span className="text-[var(--tmd-fg-3,#64748b)]">{t("活跃天数")}</span>
          <b>{t("{n} 天", { n: statDays })}</b>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--tmd-fg-3,#64748b)]">{t("会话")}</span>
          <b>{t("{n} 场", { n: statSess })}</b>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--tmd-fg-3,#64748b)]">{t("改动行")}</span>
          <b className="font-mono">
            <span className="text-emerald-600">+{statPlus}</span> / <span className="text-red-500">−{statMinus}</span>
          </b>
        </div>
      </div>
    </div>
  );
}
