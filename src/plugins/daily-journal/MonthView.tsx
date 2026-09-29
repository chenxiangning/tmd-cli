/**
 * 月视图 —— 大格索引卡:文章标题 + 总览首行 + 便签预览 + 引擎点
 * (原型 .mgrid/.dcell)。点格开文章 tab;空日也开(便签编辑态在 tab 内,B3)。
 */
import { useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { PencilSimpleLine } from "@phosphor-icons/react";
import { stringHue } from "@kernel/colorHash";
import type { DaySessionRow } from "./daySessions";
import type { MonthSnapshot } from "./journalStore";
import { dayMetaOf, deriveDayStatus, heatOf, type DayStatus } from "./journalStore";
import { pad2 } from "./journalFiles";
import { openArticleTab } from "./journalTabs";
import { enqueueTask } from "./taskQueue";
import { getJournalState } from "./journalStore";
import { weekdayLabelsMon } from "./dateTitle";
import type { DayNote, DayMeta } from "./journalFiles";
import type { Article } from "./articleParse";
import { notePeekOf } from "./statusText";
import { holOf, useHolidays } from "./holidays";

interface DayCellProps {
  y: number;
  m: number;
  d: number;
  article: Article | null;
  note: DayNote | undefined;
  meta: DayMeta;
  rows: DaySessionRow[];
  isToday: boolean;
}

/** 格 className(纯函数:状态/热力/今日/周末/便签描边合成)。 */
function cellClass(st: DayStatus, hasNote: boolean, sessionCount: number, isToday: boolean, we: boolean): string {
  return [
    "dj-cell",
    st === "n" && !hasNote ? "dj-empty-day" : heatOf(sessionCount),
    st === "p" && "dj-pending",
    st === "f" && "dj-failed",
    isToday && "dj-today",
    we && "dj-we",
    hasNote && "dj-hasnote",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 格正文(标题/总览 或 失败/待生成/空日语义行;纯函数)。 */
function cellBody(article: Article | null, st: DayStatus, meta: DayMeta, rows: DaySessionRow[], notePeek: string): React.ReactNode {
  if (article) {
    return (
      <>
        <div className="dj-head">{article.title}</div>
        <div className="dj-lede">{article.lede.split("\n")[0]}</div>
      </>
    );
  }
  if (st === "f") return <div className="dj-lede dj-err">{meta.lastError}</div>;
  if (st === "p") return <div className="dj-lede">{t("{n} 会话待提取", { n: rows.length })}</div>;
  return !notePeek && <div className="dj-lede dj-faint">{t("无会话 · 点开写便签")}</div>;
}

function DayCell({ y, m, d, article, note, meta, rows, isToday, onToast }: DayCellProps & { onToast: (msg: string) => void }) {
  const st = deriveDayStatus(article, isToday, rows.length, meta);
  const we = [0, 6].includes(new Date(y, m - 1, d).getDay());
  const engines = [...new Set(rows.map((r) => r.profileId))];
  const notePeek = notePeekOf(note);
  const [confirming, setConfirming] = useState(false);
  const open = () => openArticleTab(y, m, d, article?.title, st === "n" && !note);
  /* 两击确认(仓内「再点一次确认」同款):首击武装 3s,再击入队 + toast。 */
  const quickGen = () => {
    const key = `${y}-${pad2(m)}-${pad2(d)}`;
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    const task = enqueueTask(st === "f" ? "重试生成" : "手动生成", key, getJournalState().config.engine);
    onToast(task ? t("{m}月{d}日生成任务已转后台", { m, d }) : t("该日已有同类任务在队列"));
  };
  const canGen = st === "p" || st === "f";
  return (
    <div className="dj-cellwrap">
    <div
      className={cellClass(st, !!note, rows.length, isToday, we)}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="dj-cell-top">
        <span className="dj-daynum">{d}</span>
        {note && (
          <span className="dj-notemark" title={t("有便签")}>
            <PencilSimpleLine size={9} />
          </span>
        )}
        {holOf(y, m, d) && <span className="dj-holmini">休·{holOf(y, m, d)}</span>}
        {st === "t" && <span className="dj-badge dj-badge-t">{t("增量中")}</span>}
        {st === "p" && <span className="dj-badge dj-badge-p">{t("待生成")}</span>}
        {st === "f" && <span className="dj-badge dj-badge-f">{t("失败")}</span>}
        <span className="dj-cell-sub">{rows.length ? t("{n} 会话", { n: rows.length }) : ""}</span>
      </div>
      {cellBody(article, st, meta, rows, notePeek)}
      {notePeek && (
        <div className="dj-notepeek">
          <PencilSimpleLine size={9} /> {notePeek}
        </div>
      )}
      <div className="dj-cell-engs">
        {engines.slice(0, 5).map((e) => (
          <span key={e} className="dj-engicon">
            {host.getCliProfiles().find((p) => p.id === e)?.renderIcon?.("0.75rem") ?? (
              <i className="dj-engdot" style={{ background: `hsl(${stringHue(e)} 52% 48%)` }} />
            )}
          </span>
        ))}
      </div>
    </div>
    {canGen && (
      <div className="dj-genbtn">
        <button type="button" className={`dj-btn ${confirming ? "dj-btn-confirm" : "dj-btn-primary"}`} onClick={quickGen}>
          {confirming ? t("再点一次确认生成") : st === "f" ? t("重试生成") : t("生成此日")}
        </button>
      </div>
    )}
    </div>
  );
}

export interface MonthViewProps {
  ym: { y: number; m: number };
  snap: MonthSnapshot;
  sessions: Map<string, DaySessionRow[]>;
  today: string;
}

export function MonthView({ ym, snap, sessions, today }: MonthViewProps) {
  useHolidays(); /* 数据就位即重渲染(holOf 读快照) */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };
  const lead = (new Date(ym.y, ym.m - 1, 1).getDay() + 6) % 7; /* 周一开头 */
  const days = new Date(ym.y, ym.m, 0).getDate();
  const prefix = `${ym.y}-${pad2(ym.m)}`;
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < lead; i++) cells.push(<div key={`lead-${i}`} className="dj-cell dj-out" />);
  for (let d = 1; d <= days; d++) {
    const dd = pad2(d);
    const key = `${prefix}-${dd}`;
    cells.push(
      <DayCell
        key={dd}
        y={ym.y}
        m={ym.m}
        d={d}
        article={snap.articles[dd] ?? null}
        note={snap.notes[dd]}
        meta={dayMetaOf(key)}
        rows={sessions.get(key) ?? []}
        isToday={key === today}
        onToast={showToast}
      />,
    );
  }
  return (
    <div className="dj-month">
      <div className="dj-dow">
        {weekdayLabelsMon().map((label, i) => (
          <div key={label} className={i >= 5 ? "dj-dow-we" : ""}>
            {label}
          </div>
        ))}
      </div>
      <div className="dj-mgrid">{cells}</div>
      {toast && <div className="dj-toast">{toast}</div>}
    </div>
  );
}
