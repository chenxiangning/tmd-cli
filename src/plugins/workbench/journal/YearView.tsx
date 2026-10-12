/**
 * 年视图 —— 12 宫迷你月:状态点阵(节假日红点/便签内框/五态/热力/周末底纹)+
 * 月统计行;点月下钻月视图(原型 .year-grid/.ymonth)。
 */
import { useEffect } from "react";
import { t } from "@kernel/i18n";
import { loadMonth, useJournalState, type MonthSnapshot } from "./journalStore";
import type { DaySessionRow } from "./daySessions";
import { pad2 } from "./journalFiles";
import { monthShortOf } from "./dateTitle";
import { useHolidays } from "./holidays";
import { monthCells } from "./yearCells";

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
  const prefix = `${y}-${pad2(m)}`;
  const { cells, artDays, sessDays } = monthCells(y, m, snap, sessions, today);
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
      <div className="dj-ycal">
        {cells.map((c) => (
          <span key={c.key} className={c.cls} title={c.title} />
        ))}
      </div>
      {/* 头部已报「n 篇文章」,尾部只在全月无记录时补一句(重复播报删除) */}
      {!artDays && !sessDays ? <div className="dj-ymonth-stat">{t("无记录")}</div> : null}
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
      {/* 角部 mini 图例(归并口径):9 类状态色归并 5 类 —— 热力三档(h1/h2→弱、
          h3→中、h4→高)+ 失败(f);节假日(hol 底色)与便签(note 内框)合示一类;
          今日(t 蓝框)/待提取(p 黄)稀少态不上图例,悬格 title 自释。
          词条口径与月视图 dj-legend(热力弱→热力高/失败)复用。 */}
      <div className="dj-year-legend" aria-hidden="true">
        {t("热力弱")}
        <i className="dj-yl-sw lo" /> <i className="dj-yl-sw mid" /> <i className="dj-yl-sw hi" />
        {t("热力高")}
        <i className="dj-yl-sw f" /> {t("失败")}
        <i className="dj-yl-sw hol" /> <i className="dj-yl-sw note" /> {t("节假日/便签")}
      </div>
    </div>
  );
}
