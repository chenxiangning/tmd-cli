/**
 * 月格渲染件(300 行纪律,自 MonthView.tsx 就地迁出):
 * 格正文状态行 / 日历叠层条目条;纯样式类与月统计在 ./monthGrid。
 */
import { t } from "@kernel/i18n";
import { openProjectTab } from "../wbTabs";
import type { CalendarItem } from "../calendarTimeline";
import { toneVar } from "../tone";
import type { DaySessionRow } from "./daySessions";
import type { DayMeta } from "./journalFiles";
import type { DayStatus } from "./journalStore";
import type { Article } from "./articleParse";

/** 格正文(状态 pill 条:热力底 + 单行当日状态;状态行统一 title 全文兜住截断,
 *  失败日 title 优先完整错误)。
 *  showIdle=false 的空日不渲染灰字文案(B3:占位噪音),title 保留 hover 可读。 */
export function CellBody({ article, st, meta, rows, notePeek, heat, showIdle }: {
  article: Article | null;
  st: DayStatus;
  meta: DayMeta;
  rows: DaySessionRow[];
  notePeek: string;
  heat: string;
  showIdle: boolean;
}) {
  const noteTag = notePeek ? ` · ${t("有便签")}` : "";
  if (article) {
    const line =
      (st === "t" ? t("增量中 · {n} 条会话", { n: rows.length }) : t("已生成 · {n} 条会话", { n: rows.length })) + noteTag;
    return (
      <div className={`dj-stat ${st === "t" ? "dj-accent" : heat}`} title={line}>
        {line}
      </div>
    );
  }
  if (st === "f") {
    const line = t("生成失败 · {n} 条会话", { n: rows.length }) + noteTag;
    return (
      <div className="dj-stat dj-err" title={meta.lastError || line}>
        {line}
      </div>
    );
  }
  if (st === "p") {
    const line = t("待提取 · {n} 条会话", { n: rows.length }) + noteTag;
    return (
      <div className="dj-stat dj-warn" title={line}>
        {line}
      </div>
    );
  }
  const line = notePeek ? t("无会话 · 有便签") : t("无会话 · 点开写便签");
  if (!showIdle) return <div className="dj-stat dj-faint" title={line} />;
  return (
    <div className="dj-stat dj-faint" title={line}>
      {line}
    </div>
  );
}

/** 日历叠层条目:真 button,渲染在交互日格之外(cellwrap 直下兄弟位 ——
 * 日格自身是 role=button 键盘单元,内嵌 focusable 构成嵌套交互件);
 * 点条目开项目详情;超 2 条溢出 +N(title 列溢出条目明细,D4)。 */
export function DueStrip({ cal }: { cal: CalendarItem[] }) {
  if (cal.length === 0) return null;
  return (
    <div className="dj-cell-due">
      {cal.slice(0, 2).map((item) => (
        <button
          key={item.key}
          type="button"
          className="dj-cell-due-item"
          style={{ color: toneVar(item.tone) }}
          title={`${item.title}(${item.label})`}
          onClick={() => openProjectTab(item.projectId, item.projectName ?? item.title)}
        >
          {item.title}
        </button>
      ))}
      {cal.length > 2 && (
        <span
          className="dj-cell-due-more"
          title={cal
            .slice(2)
            .map((item) => `${item.title}(${item.label})`)
            .join("\n")}
        >
          +{cal.length - 2}
        </span>
      )}
    </div>
  );
}
