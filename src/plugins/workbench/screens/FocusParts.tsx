/**
 * 工作台聚焦页拆分件(自 FocusScreen.tsx 拆出守 300 行铁则,2026-10-12)。
 * FocusBandSection = 接下来 14 天段;GhostIndex = 空壳折叠索引;
 * PulseActivity = 脉搏行活动摘要(2026-10-13 自 FocusScreen 迁入)。
 */

import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { CaretRight, ChatCircle, FileText, Notebook } from "@phosphor-icons/react";
import type { Project } from "../types";
import { dayShortOf, weekdayShortOf } from "../journal/dateTitle";
import { collectLinkedSessions } from "../views";
import { formatUpdateAt } from "../kindLabels";
import { activityAge, type ActivityKind, type BandDdl, type BandDay, type PulseRow } from "../focusModel";

/** 单日项目 chip:DDL 与当日到期任务显式归属项目(A3),计数 = 该项目当日到期任务数。 */
interface DayProjectChip {
  projectId: string;
  name: string;
  ddl?: BandDdl;
  count: number;
}

function dayChips(day: BandDay): DayProjectChip[] {
  const byId = new Map<string, DayProjectChip>();
  const touch = (projectId: string, name: string) => {
    let chip = byId.get(projectId);
    if (!chip) {
      chip = { projectId, name, count: 0 };
      byId.set(projectId, chip);
    }
    return chip;
  };
  for (const ddl of day.ddls) touch(ddl.projectId, ddl.name).ddl = ddl;
  for (const item of day.tasks) touch(item.projectId, item.projectName).count += 1;
  return [...byId.values()];
}

/** 接下来 14 天:只有事日渲染紧凑 chip,全空一行说明;chip = 项目名,有当日到期任务才显计数。 */
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
              {dayChips(day).map((chip) => {
                const tone = chip.ddl?.tone ?? "muted";
                const title = chip.ddl
                  ? t("{name} · 截止日", { name: chip.name })
                    + (chip.count > 0 ? ` · ${t("任务 ×{count}", { count: chip.count })}` : "")
                  : t("{name} · {count} 条任务到期", { name: chip.name, count: chip.count });
                return (
                  <button
                    key={chip.projectId} type="button" className={`wb-focus-ddl is-${tone}`}
                    title={title} onClick={() => onOpen(chip.projectId)}
                  >
                    {chip.name}
                    {chip.count > 0 ? <span className="wb-focus-cnt"> ×{chip.count}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 活动源标签(内容层,UI 经 t() 过词典)。 */
const ACTIVITY_LABELS: Record<ActivityKind, string> = { session: "会话", doc: "文档", update: "进展" };
const ACTIVITY_ICONS: Record<ActivityKind, typeof ChatCircle> = { session: ChatCircle, doc: FileText, update: Notebook };

/** 活动相对日:今天/昨天/N 天前,更早落 MM-DD HH:mm。 */
function activityWhen(at: string, today: string): string {
  const age = activityAge(at, today);
  if (age === 0) return t("今天");
  if (age === 1) return t("昨天");
  if (age !== null && age >= 2 && age <= 6) return t("{n} 天前", { n: age });
  return formatUpdateAt(at);
}

/** 脉搏行活动摘要(A4):「会话 N · 2 天前」语义化计数,悬停给最近活动明细,不再裸摆密语。 */
export function PulseActivity({ row, today }: { row: PulseRow; today: string }) {
  const activity = row.activity;
  const sessionCount = useMemo(
    () => (activity?.kind === "session" ? collectLinkedSessions(row.project.tasks).length : 0),
    [activity, row.project.tasks],
  );
  if (!activity) return <span>—</span>;
  const Icon = ACTIVITY_ICONS[activity.kind];
  const n = activity.kind === "session" ? sessionCount : null;
  return (
    <>
      <Icon size={12} />
      <span className="wb-pulse-act-kind">{t(ACTIVITY_LABELS[activity.kind])}{n !== null ? ` ${n}` : ""}</span>
      <span className="wb-pulse-act-text" title={activity.text}>{activityWhen(activity.at, today)} · {activity.text}</span>
    </>
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
