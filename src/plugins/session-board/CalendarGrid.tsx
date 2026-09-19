/**
 * 看板月历网格 —— 周条/折叠条/热力格(自 BoardTab 拆出,文件规模铁则)。
 * 选中日所在周展开为七格周条,其余周折叠为区间行(点击选该周首个有会话日);
 * 格底色 = 当日会话数热力(sqrt 四级,当月最大值归一),格底 3 点 = 主引擎,
 * 右上玫红点 = 当日存在「结束-未查看」。
 */
import { useMemo } from "react";
import { t } from "@kernel/i18n";
import { dayKeyOf, dayStartOf, engineColor, weekdayLabels, type BoardSession } from "./boardData";

interface DayCell {
  ts: number;
  key: string;
  inMonth: boolean;
}

function monthCells(y: number, m: number): DayCell[] {
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ ts: d.getTime(), key: dayKeyOf(d.getTime()), inMonth: d.getMonth() === m });
  }
  return cells;
}

/** 按周切分月格(共 6 周,末空周自动裁掉)。 */
function weeksOf(cells: DayCell[]): DayCell[][] {
  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  while (weeks.length > 0 && weeks[weeks.length - 1].every((c) => !c.inMonth)) weeks.pop();
  return weeks;
}

export function CalendarGrid({
  view,
  byDay,
  selDay,
  onSelect,
}: {
  view: { y: number; m: number };
  byDay: Map<string, BoardSession[]>;
  selDay: string | null;
  onSelect: (key: string | null) => void;
}) {
  const cells = useMemo(() => monthCells(view.y, view.m), [view.y, view.m]);
  const weeks = useMemo(() => weeksOf(cells), [cells]);
  /* 归一只取当月格(c.inMonth):cells 含相邻月溢出格,极端日会压当月色阶。 */
  const maxDay = useMemo(() => {
    let max = 0;
    for (const c of cells) if (c.inMonth) max = Math.max(max, byDay.get(c.key)?.length ?? 0);
    return max;
  }, [cells, byDay]);
  const todayKey = dayKeyOf(Date.now());
  const selWeekIdx = weeks.findIndex((w) => w.some((c) => c.key === selDay));

  return (
    <div className="sb-calendar">
      <div className="sb-weekdays">
        {weekdayLabels().map((w, i) => (
          <span key={w} className={i === 0 || i === 6 ? "sb-wd off" : "sb-wd"}>
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week, wi) => {
        if (selDay && wi !== selWeekIdx) {
          const n = week.reduce((acc, c) => acc + (byDay.get(c.key)?.length ?? 0), 0);
          const a = new Date(week[0].ts);
          const b = new Date(week[6].ts);
          const range =
            a.getMonth() === b.getMonth()
              ? `${a.getMonth() + 1}/${a.getDate()} – ${b.getDate()}`
              : `${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`;
          return (
            <button
            key={week[0].key}
              type="button"
              className="sb-strip"
              onClick={() => {
                const pick =
                  week.find((c) => c.inMonth && (byDay.get(c.key)?.length ?? 0) > 0) ??
                  week.find((c) => c.inMonth) ??
                  week[0];
                onSelect(pick.key);
              }}
            >
              <span className="sb-strip-range">{range}</span>
              <span className="sb-strip-n">{t("{n} 个会话", { n })}</span>
            </button>
          );
        }
        return (
          <div key={week[0].key} className="sb-week">
            {week.map((c) => {
              const rows = byDay.get(c.key) ?? [];
              /* 未来 = 明天 0 点起(旧判定 +24h 放过明天,明天可点开空日面板,评审 P2)。 */
              const future = c.ts >= dayStartOf(Date.now()) + 86_400_000;
              const hasNew = rows.some((s) => s.st === "ended-new");
              const level = maxDay > 0 ? Math.ceil(Math.sqrt(rows.length / maxDay) * 4) : 0;
              const top = new Map<string, number>();
              for (const s of rows) top.set(s.profileId, (top.get(s.profileId) ?? 0) + 1);
              const dots = [...top.entries()].sort((x, y2) => y2[1] - x[1]).slice(0, 3);
              const d = new Date(c.ts);
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={future}
                  className={[
                    "sb-cell",
                    c.inMonth ? "" : "out",
                    rows.length ? `sb-h${level}` : "",
                    c.key === todayKey ? "today" : "",
                    c.key === selDay ? "sel" : "",
                    future ? "future" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelect(c.key === selDay ? null : c.key)}
                  title={`${d.getMonth() + 1}/${d.getDate()} · ${rows.length}`}
                >
                  <span className="sb-cell-head">
                    <span className="sb-cell-n">{d.getDate()}</span>
                    {rows.length > 0 && <span className="sb-cell-count">{rows.length}</span>}
                    {hasNew && <span className="sb-cell-new" aria-label={t("有未查看会话")} />}
                  </span>
                  {dots.length > 0 && (
                    <span className="sb-cell-dots" aria-hidden>
                      {dots.map(([pid]) => (
                        <i key={pid} style={{ background: engineColor(pid) }} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
