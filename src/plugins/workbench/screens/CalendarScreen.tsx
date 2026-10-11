/**
 * 工作台 · 日历视图:月历网格,DDL 与未完成任务落格(风险着色),翻月/回今天,
 * 点项目名开详情。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { calendarMonth, monthKeyOf, shiftMonth } from "../calendarTimeline";
import { toneVar } from "../tone";
import { WbEmpty } from "../ui";
import type { WbScreenProps } from "./cards";

export function CalendarScreen({ projects, today, onOpen }: WbScreenProps) {
  const [month, setMonth] = useState(() => monthKeyOf(today));
  const model = calendarMonth(projects, today, month);
  const weekday = [t("日"), t("一"), t("二"), t("三"), t("四"), t("五"), t("六")];
  if (projects.length === 0) return <WbEmpty text={t("当前筛选下没有项目,日历是空的。")} />;
  return (
    <div className="wb-calendar">
      <div className="wb-cal-bar">
        <button type="button" className="wb-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("上个月")}>‹</button>
        <b>{model.label}</b>
        <button type="button" className="wb-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("下个月")}>›</button>
        <button type="button" className="wb-btn" onClick={() => setMonth(monthKeyOf(today))}>{t("今天")}</button>
        <span className="wb-count">{model.monthItems} 条 · {model.daysWithItems} 天</span>
      </div>
      <div className="wb-cal-grid">
        {weekday.map((label) => <span key={label} className="wb-cal-wd">{label}</span>)}
        {model.cells.map((cell) => (
          <div
            key={cell.iso}
            className={`wb-cal-cell${cell.inMonth ? "" : " out"}${cell.isToday ? " today" : ""}${cell.isWeekend ? " weekend" : ""}`}
          >
            <span className="wb-cal-day">{cell.day}</span>
            <span className="wb-cal-items">
              {cell.items.slice(0, 3).map((item) => (
                <button
                  key={item.key} type="button"
                  className="wb-cal-item" style={{ color: toneVar(item.tone) }}
                  title={`${item.title}(${item.label})`}
                  onClick={() => onOpen(item.projectId)}
                >
                  {item.title}
                </button>
              ))}
              {cell.items.length > 3 ? <span className="wb-cal-more">+{cell.items.length - 3}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
