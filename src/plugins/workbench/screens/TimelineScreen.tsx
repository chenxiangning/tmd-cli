/**
 * 工作台 · 时间线视图:甘特式横条,每行一个项目按起止日期定位,风险着色,
 * 周刻度 + 今天竖线。
 */

import { t } from "@kernel/i18n";
import type { CSSProperties } from "react";
import { timelineModel } from "../calendarTimeline";
import { toneVar } from "../tone";
import { WbEmpty } from "../ui";
import type { WbScreenProps } from "./cards";

export function TimelineScreen({ projects, today, onOpen }: WbScreenProps) {
  const model = timelineModel(projects, today);
  if (projects.length === 0) return <WbEmpty text={t("当前筛选下没有项目,时间线是空的。")} />;
  return (
    <div className="wb-timeline">
      {model.padded ? <p className="wb-muted wb-tl-pad-hint">{t("项目跨度过长,只显示前 210 天。")}</p> : null}
      <div className="wb-tl-scroll">
        <div className="wb-tl-inner" style={{ minWidth: `${Math.max(model.totalDays * 14, 480)}px`, "--wb-today": `${model.todayPercent}%` } as CSSProperties}>
          <div className="wb-tl-scale">
            {model.ticks.map((tick) => (
              <span key={tick.index} className="wb-tl-tick" style={{ left: `${tick.percent}%` }}>{tick.label}</span>
            ))}
            <span className="wb-tl-today" style={{ left: `${model.todayPercent}%` }} aria-hidden />
          </div>
          {model.rows.map((row) => (
            <div key={row.project.id} className="wb-tl-row">
              <button type="button" className="wb-link wb-tl-name" onClick={() => onOpen(row.project.id)}>{row.project.name}</button>
              <div className="wb-tl-track">
                <button
                  type="button"
                  className="wb-tl-bar"
                  title={`${row.project.name}:${row.startIso} → ${row.endIso}(${row.risk.label})`}
                  style={{ left: `${row.leftPercent}%`, width: `${Math.max(row.widthPercent, 1.5)}%`, background: toneVar(row.risk.tone) }}
                  onClick={() => onOpen(row.project.id)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
