/**
 * 工作台聚焦页拆分件(自 FocusScreen.tsx 拆出守 300 行铁则,2026-10-12)。
 * FocusBandSection = 接下来 14 天段;GhostIndex = 空壳折叠索引。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { CaretRight } from "@phosphor-icons/react";
import type { Project } from "../types";
import { dayShortOf, weekdayShortOf } from "../journal/dateTitle";
import type { BandDay } from "../focusModel";

/** 接下来 14 天:只有事日渲染紧凑 chip,全空一行说明。 */
export function FocusBandSection({ band, onOpen }: { band: BandDay[]; onOpen: (id: string) => void }) {
  return (
    <section className="wb-focus-sec">
      <h3 className="wb-focus-sec-head">{t("接下来 14 天")}</h3>
      {band.every((day) => day.ddls.length === 0 && day.tasks.length === 0) ? (
        <p className="wb-muted">{t("未来 14 天没有到期事项。")}</p>
      ) : (
        <div className="wb-focus-band">
          {band.filter((day) => day.ddls.length > 0 || day.tasks.length > 0).map((day) => (
            <div key={day.iso} className={`wb-focus-day${day.isToday ? " is-today" : ""}`}>
              <span className="wb-focus-day-label">
                {day.isToday ? t("今天") : dayShortOf(day.date)}
                <em className="wb-focus-day-wd">{weekdayShortOf(day.date)}</em>
              </span>
              {day.ddls.map((ddl) => (
                <button
                  key={ddl.projectId} type="button" className={`wb-focus-ddl is-${ddl.tone}`}
                  title={t("{name} · 截止日", { name: ddl.name })}
                  onClick={() => onOpen(ddl.projectId)}
                >{ddl.name}</button>
              ))}
              {day.tasks.length > 0 ? (
                <span
                  className="wb-focus-cnt"
                  title={t("当日到期任务:{titles}", { titles: day.tasks.map((item) => item.title).join(t("、")) })}
                >{t("任务 ×{count}", { count: day.tasks.length })}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 空壳折叠索引:默认一行,展开为带过滤框的字母序 chip 墙。 */
export function GhostIndex({ ghosts, onOpen }: { ghosts: Project[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const shown = filter ? ghosts.filter((g) => g.name.toLowerCase().includes(filter.toLowerCase())) : ghosts;
  return (
    <div className="wb-focus-ghosts">
      <div className="wb-focus-strip-row">
        <button type="button" className="wb-focus-strip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <CaretRight size={9} className={open ? "is-open" : undefined} />
          {t("{count} 个未跟踪项目", { count: ghosts.length })}
        </button>
        {open ? (
          <input
            className="wb-ghost-filter" type="text" value={filter}
            placeholder={t("过滤:输入名称关键字")}
            onChange={(e) => setFilter(e.target.value)}
          />
        ) : null}
      </div>
      {open ? (
        <div className="wb-ghost-grid">
          {shown.length === 0
            ? <span className="wb-muted">{t("没有匹配的项目")}</span>
            : shown.map((g) => (
              <button key={g.id} type="button" className="wb-chip" onClick={() => onOpen(g.id)}>{g.name}</button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
