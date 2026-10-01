/**
 * 月视图 —— 大格状态卡:单行当日状态(生成状态 · 会话数 · 有便签)+ 便签预览 + 引擎点
 * (原型 .mgrid/.dcell)。点格开文章 tab;空日也开(便签编辑态在 tab 内,B3)。
 */
import { useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { PencilSimpleLine } from "@phosphor-icons/react";
import { stringHue } from "@kernel/colorHash";
import type { DaySessionRow } from "./daySessions";
import { isRowSummarized } from "./daySessions";
import type { MonthSnapshot } from "./journalStore";
import { dayMetaOf, deriveDayStatus, heatOf, heatThresholds, type DayStatus, type HeatThresholds } from "./journalStore";
import { pad2 } from "./journalFiles";
import { openArticleTab } from "./journalTabs";
import { dayGenTaskType, enqueueTask } from "./taskQueue";
import { getJournalState } from "./journalStore";
import { weekdayLabelsMon } from "./dateTitle";
import type { DayNote, DayMeta } from "./journalFiles";
import type { Article } from "./articleParse";
import { notePeekOf } from "./statusText";
import { holOf, isWorkdayOverride, useHolidays } from "./holidays";

interface DayCellProps {
  y: number;
  m: number;
  d: number;
  article: Article | null;
  note: DayNote | undefined;
  meta: DayMeta;
  rows: DaySessionRow[];
  isToday: boolean;
  ts: HeatThresholds;
}

/** 格 className(纯函数:今日/周末;热力与状态色改由正文 pill 承载,格底保持白净)。 */
function cellClass(isToday: boolean, we: boolean): string {
  return ["dj-cell", isToday && "dj-today", we && "dj-we"].filter(Boolean).join(" ");
}

/** 格正文(状态 pill 条:热力底 + 单行当日状态;失败完整错误转 title 悬停;纯函数)。 */
function cellBody(article: Article | null, st: DayStatus, meta: DayMeta, rows: DaySessionRow[], notePeek: string, heat: string): React.ReactNode {
  const noteTag = notePeek ? ` · ${t("有便签")}` : "";
  if (article) {
    const line =
      (st === "t" ? t("增量中 · {n} 条会话", { n: rows.length }) : t("已生成 · {n} 条会话", { n: rows.length })) + noteTag;
    return <div className={`dj-stat ${st === "t" ? "dj-accent" : heat}`}>{line}</div>;
  }
  if (st === "f")
    return (
      <div className="dj-stat dj-err" title={meta.lastError || undefined}>
        {t("生成失败 · {n} 条会话", { n: rows.length }) + noteTag}
      </div>
    );
  if (st === "p") return <div className="dj-stat dj-warn">{t("待提取 · {n} 条会话", { n: rows.length }) + noteTag}</div>;
  return <div className="dj-stat dj-faint">{notePeek ? t("无会话 · 有便签") : t("无会话 · 点开写便签")}</div>;
}

function DayCell({ y, m, d, article, note, meta, rows, isToday, ts, onToast }: DayCellProps & { onToast: (msg: string) => void }) {
  const st = deriveDayStatus(article, isToday, rows.length, meta);
  /* 调休上班日(off:false)不画周末底纹(与年视图/月条同律) */
  const we = [0, 6].includes(new Date(y, m - 1, d).getDay()) && !isWorkdayOverride(y, m, d);
  const hol = holOf(y, m, d);
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
    /* enqueueTask 日粒度闸:同日已有任务(任意类型)拒入返回 null,同 toast 反馈。 */
    const task = enqueueTask(dayGenTaskType(st === "f", !!article), key, getJournalState().config.engine);
    onToast(task ? t("{m}月{d}日生成任务已转后台", { m, d }) : t("该日已有生成任务在队列"));
  };
  /* 有文章且存在待归纳行(含今日增量中)也出按钮:手动发起增量并入的月格入口。 */
  const hasPending = rows.some((r) => !isRowSummarized(r, meta.summarizedAt));
  const canGen = st === "p" || st === "f" || (!!article && hasPending);
  return (
    <div className="dj-cellwrap">
    <div
      className={cellClass(isToday, we)}
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
      </div>
      {hol && <div className="dj-holpill">休·{hol}</div>}
      {cellBody(article, st, meta, rows, notePeek, st === "g" ? heatOf(rows.length, ts) : "")}
      {notePeek && (
        <div className="dj-notepeek">
          <PencilSimpleLine size={9} />
          <span className="dj-notepeek-t">{notePeek}</span>
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
          {confirming ? t("再点一次确认生成") : st === "f" ? t("重试生成") : article ? t("增量并入") : t("生成此日")}
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
  /** 跨月补位格点击跳月(常见日历可供性;缺省无回调则维持纯展示)。 */
  onShiftMonth?: (delta: number) => void;
}

export function MonthView({ ym, snap, sessions, today, onShiftMonth }: MonthViewProps) {
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
  /* 热力阈值随月重算:当月活跃日会话数取 25/50/75 分位,层次感自适应分布。 */
  const ts = useMemo(() => {
    const counts: number[] = [];
    for (let d = 1; d <= days; d++) {
      const rows = sessions.get(`${prefix}-${pad2(d)}`);
      if (rows?.length) counts.push(rows.length);
    }
    return heatThresholds(counts);
  }, [sessions, prefix, days]);
  /* 图2 式整月固定 6 行 42 格:前后月补位编灰号,行高跨月一致。 */
  const SLOTS = 42;
  const prevDays = new Date(ym.y, ym.m - 1, 0).getDate();
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < lead; i++)
    cells.push(
      /* 前月补位格可点跳上月(pointer-events:none 摘除;弱化视觉保留) */
      <div
        key={`lead-${i}`}
        className="dj-cell dj-out"
        role="button"
        tabIndex={0}
        title={t("跳到上个月")}
        onClick={() => onShiftMonth?.(-1)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onShiftMonth?.(-1);
          }
        }}
      >
        <div className="dj-cell-top">
          <span className="dj-daynum">{prevDays - lead + 1 + i}</span>
        </div>
      </div>,
    );
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
        ts={ts}
        onToast={showToast}
      />,
    );
  }
  for (let d = 1; lead + days + d <= SLOTS; d++)
    cells.push(
      <div
        key={`tail-${d}`}
        className="dj-cell dj-out"
        role="button"
        tabIndex={0}
        title={t("跳到下个月")}
        onClick={() => onShiftMonth?.(1)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onShiftMonth?.(1);
          }
        }}
      >
        <div className="dj-cell-top">
          <span className="dj-daynum">{d}</span>
        </div>
      </div>,
    );
  return (
    <div className="dj-month">
      <div className="dj-dow">
        {weekdayLabelsMon().map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="dj-mgrid">{cells}</div>
      {toast && <div className="dj-toast">{toast}</div>}
    </div>
  );
}
