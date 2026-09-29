/**
 * 年视图 —— 12 宫迷你月:状态点阵(节假日红点/便签内框/五态/热力/周末底纹)+
 * 月统计行;点月下钻月视图(原型 .year-grid/.ymonth)。
 */
import { useEffect } from "react";
import { t } from "@kernel/i18n";
import { loadMonth, dayMetaOf, deriveDayStatus, useJournalState, type MonthSnapshot } from "./journalStore";
import type { DaySessionRow } from "./daySessions";
import { pad2 } from "./journalFiles";
import { monthShortOf } from "./dateTitle";
import { holOf, useHolidays } from "./holidays";

/** 点阵类叠层(状态底色 + 周末底纹 + 便签内框,原型同款可共存)。 */
const cellCls = (st: string, hasNote: boolean, count: number, hol: boolean, we: boolean): string =>
  [
    hol ? "dj-yc-hol" : st === "t" ? "dj-yc-t" : st === "p" ? "dj-yc-p" : st === "f" ? "dj-yc-f" : st === "g" ? (count >= 9 ? "dj-yc-h3" : count >= 6 ? "dj-yc-h2" : "dj-yc-g") : "",
    we ? "dj-yc-we" : "",
    hasNote ? "dj-yc-note" : "",
  ]
    .filter(Boolean)
    .join(" ");

function MiniMonth({
  y,
  m,
  snap,
  sessions,
  today,
  onOpen,
}: {
  y: number;
  m: number;
  snap: MonthSnapshot | undefined;
  sessions: Map<string, DaySessionRow[]>;
  today: string;
  onOpen: (m: number) => void;
}) {
  const days = new Date(y, m, 0).getDate();
  const prefix = `${y}-${pad2(m)}`;
  const dots: React.ReactNode[] = [];
  let artDays = 0;
  let sessDays = 0;
  for (let d = 1; d <= days; d++) {
    const dd = pad2(d);
    const key = `${prefix}-${dd}`;
    const rows = sessions.get(key) ?? [];
    const article = snap?.articles[dd] ?? null;
    if (article) artDays++;
    if (rows.length) sessDays++;
    const we = [0, 6].includes(new Date(y, m - 1, d).getDay());
    const st = deriveDayStatus(article, key === today, rows.length, dayMetaOf(key));
    dots.push(
      <span
        key={dd}
        className={cellCls(st, !!snap?.notes[dd], rows.length, !!holOf(y, m, d), we)}
        title={`${m}/${d} · ${rows.length}`}
      />,
    );
  }
  return (
    <div
      className={`dj-ymonth ${today.startsWith(prefix) ? "dj-ymonth-cur" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(m)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(m);
        }
      }}
    >
      <h3>
        {monthShortOf(m)}{" "}
        <span className="dj-ymonth-n">
          {t("{n} 天有记录", { n: sessDays })} · {t("{n} 篇文章", { n: artDays })}
        </span>
      </h3>
      <div className="dj-ycal">{dots}</div>
      <div className="dj-ymonth-stat">{artDays ? t("{n} 篇文章", { n: artDays }) : t("无记录")}</div>
    </div>
  );
}

export function YearView({
  y,
  sessions,
  today,
  onOpenMonth,
}: {
  y: number;
  sessions: Map<string, DaySessionRow[]>;
  today: string;
  onOpenMonth: (m: number) => void;
}) {
  const state = useJournalState();
  useHolidays();
  useEffect(() => {
    for (let m = 1; m <= 12; m++) void loadMonth(y, m);
  }, [y, state.ready]);
  return (
    <div className="dj-year-grid">
      {Array.from({ length: 12 }, (_, i) => (
        <MiniMonth
          key={i + 1}
          y={y}
          m={i + 1}
          snap={state.months[`${y}-${pad2(i + 1)}`]}
          sessions={sessions}
          today={today}
          onOpen={onOpenMonth}
        />
      ))}
    </div>
  );
}
