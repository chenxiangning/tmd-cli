/**
 * 每日日志主视图 tab —— 工具栏(年/月/轴 seg + 月导航 + 状态 pill)+ 视图路由
 * (原型 docs/design/daily-journal-n4-merged.html 三视图一 tab)。
 */
import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight, GearSix, ListChecks } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { loadMonth, useJournalState } from "./journalStore";
import { useDaySessions, todayKey, type DaySessionRow } from "./daySessions";
import type { MonthSnapshot } from "./journalStore";
import { MonthView } from "./MonthView";
import { TaskPanel } from "./TaskPanel";
import { GenSettings } from "./GenSettings";
import { useGenTasks } from "./taskQueue";
import { fillPendingDays } from "./journalSchedule";
import { YearView } from "./YearView";
import { FlowView } from "./FlowView";
import { monthTitleOf } from "./dateTitle";
import { ensureHolidays, useHolidays, type HolidayStatus } from "./holidays";
import "./daily-journal.css";

export type JournalView = "y" | "m" | "f";


/* fillPendingDays 入队策略见 journalSchedule(「补齐待生成」按钮消费)。 */

function StatusPills({ days, sessTotal, artTotal, pending, todayLive }: { days: number; sessTotal: number; artTotal: number; pending: number; todayLive: number }) {
  return (
    <>
      <span className="dj-pill">
        {t("本月 {days} 天有记录 · {sess} 会话 · {arts} 篇文章", { days, sess: sessTotal, arts: artTotal })}
      </span>
      {pending > 0 && <span className="dj-pill dj-pill-warn">{t("{n} 天待生成", { n: pending })}</span>}
      {todayLive > 0 && <span className="dj-pill dj-pill-live">{t("今日增量中 · {n} 会话进行", { n: todayLive })}</span>}
    </>
  );
}

function ToolbarEnd({ activeTasks, holOn, holStatus, onHol, onRescan, onTasks, onCfg }: { activeTasks: number; holOn: boolean; holStatus: HolidayStatus; onHol: () => void; onRescan: () => void; onTasks: () => void; onCfg: () => void }) {
  return (
    <>
      {holOn && (
        <button type="button" className={`dj-pill dj-hol${holStatus === "online" ? " on" : ""}`} onClick={onHol} title={t("点击重新拉取节假日数据")}>
          {holStatus === "online" ? t("节假日 · 在线") : holStatus === "cached" ? t("节假日 · 缓存") : t("节假日 · 离线保底")}
        </button>
      )}
      <span className="dj-legend">
        {t("热力弱")}
        <i className="dj-leg-cell" />
        <i className="dj-leg-cell h1" />
        <i className="dj-leg-cell h2" />
        <i className="dj-leg-cell h3" />
        <i className="dj-leg-cell h4" />
        {t("热力高 = 会话数")}
      </span>
      <button type="button" className="dj-btn" onClick={onRescan}>
        {t("重新扫描")}
      </button>
      <button type="button" className="dj-btn" onClick={onTasks}>
        <ListChecks size={11} /> {t("后台任务")}
        {activeTasks > 0 && <span className="dj-task-badge">{activeTasks}</span>}
      </button>
      <button type="button" className="dj-btn" onClick={onCfg} aria-label={t("生成设置")}>
        <GearSix size={11} />
      </button>
    </>
  );
}

/** 月统计(纯函数:有记录天数/会话总数/文章数/待生成数/今日活会话)。 */
function monthStats(
  sessions: Map<string, DaySessionRow[]> | null,
  snap: MonthSnapshot | undefined,
  ym: { y: number; m: number },
  today: string,
): { days: number; sessTotal: number; artTotal: number; pending: number; todayLive: number } {
  if (!sessions) return { days: 0, sessTotal: 0, artTotal: 0, pending: 0, todayLive: 0 };
  const prefix = `${ym.y}-${String(ym.m).padStart(2, "0")}`;
  const days = [...sessions.keys()].filter((k) => k.startsWith(prefix));
  const sessTotal = days.reduce((a, k) => a + (sessions.get(k)?.length ?? 0), 0);
  const artTotal = days.filter((k) => snap?.articles[k.slice(8)]).length;
  const pending = days.filter((k) => !snap?.articles[k.slice(8)] && (sessions.get(k)?.length ?? 0) > 0).length;
  const todayLive = sessions.get(today)?.filter((r) => r.live).length ?? 0;
  return { days: days.length, sessTotal, artTotal, pending, todayLive };
}

/** 舞台视图路由(三视图一 tab;独立函数保全主组件控制流复杂度门禁)。 */
function JournalStage({
  view,
  sessions,
  progress,
  ym,
  snap,
  today,
  openMonth,
}: {
  view: JournalView;
  sessions: Map<string, DaySessionRow[]> | null;
  progress: { done: number; total: number } | null;
  ym: { y: number; m: number };
  snap: MonthSnapshot | undefined;
  today: string;
  openMonth: (m: number) => void;
}) {
  if (sessions === null) {
    return (
      <div className="dj-empty">
        {t("正在扫描会话…")}
        {progress ? ` (${progress.done}/${progress.total})` : ""}
      </div>
    );
  }
  if (view === "y") return <YearView y={ym.y} sessions={sessions} today={today} onOpenMonth={openMonth} />;
  if (!snap) return <div className="dj-empty">{t("正在加载…")}</div>;
  if (view === "m") return <MonthView ym={ym} snap={snap} sessions={sessions} today={today} />;
  return <FlowView ym={ym} snap={snap} sessions={sessions} today={today} />;
}

export function JournalTab() {
  const now = new Date();
  const [view, setView] = useState<JournalView>("m");
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [refreshTick, setRefreshTick] = useState(0);
  const [panel, setPanel] = useState<"tasks" | "cfg" | null>(null);
  const tasks = useGenTasks();
  const hol = useHolidays();
  const { list } = useWorkspaces();
  const workspaces = useMemo(
    () => list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec),
    [list],
  );
  const state = useJournalState();
  const { days: sessions, progress } = useDaySessions(workspaces, refreshTick);
  useEffect(() => {
    void loadMonth(ym.y, ym.m);
    void ensureHolidays(ym.y); /* 跨年导航即拉当年(24h 窗内零请求) */
  }, [ym, state.ready]);
  const snap = state.months[`${ym.y}-${String(ym.m).padStart(2, "0")}`];
  /* 年视图导航只动年;月/轴视图动月(跨年进位)。 */
  const nav = (delta: number) => {
    if (view === "y") {
      setYm((prev) => ({ ...prev, y: prev.y + delta }));
      return;
    }
    setYm((prev) => {
      const d = new Date(prev.y, prev.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  };
  const openMonth = (m: number) => {
    setYm((prev) => ({ ...prev, m }));
    setView("m");
  };
  const today = todayKey();
  const stats = monthStats(sessions, snap, ym, today);
  return (
    <div className="dj-root">
      <div className="dj-toolbar">
        <div className="dj-seg" role="tablist">
          {(
            [
              ["y", t("年视图")],
              ["m", t("月视图")],
              ["f", t("轴视图")],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="dj-nav">
          <button className="dj-btn" aria-label={t("上个月")} onClick={() => nav(-1)}>
            <CaretLeft size={12} weight="bold" />
          </button>
          <span className="dj-month-title">{view === "y" ? String(ym.y) : monthTitleOf(ym.y, ym.m)}</span>
          <button className="dj-btn" aria-label={t("下个月")} onClick={() => nav(1)}>
            <CaretRight size={12} weight="bold" />
          </button>
        </div>
        <button
          className="dj-btn dj-today"
          onClick={() => {
            setYm({ y: now.getFullYear(), m: now.getMonth() + 1 });
            setView("m");
          }}
        >
          {t("今天")}
        </button>
        <StatusPills days={stats.days} sessTotal={stats.sessTotal} artTotal={stats.artTotal} pending={stats.pending} todayLive={stats.todayLive} />
        {stats.pending > 0 && sessions && (
          <button type="button" className="dj-btn" onClick={() => fillPendingDays(ym, sessions, snap)}>
            {t("补齐待生成")}
          </button>
        )}
        <div className="dj-toolbar-end">
          <ToolbarEnd
            activeTasks={tasks.filter((x) => x.st === "run" || x.st === "queue").length}
            holOn={state.config.holidaysOn}
            holStatus={hol.status}
            onHol={() => void ensureHolidays(ym.y, true)}
            onRescan={() => setRefreshTick((v) => v + 1)}
            onTasks={() => setPanel("tasks")}
            onCfg={() => setPanel("cfg")}
          />
        </div>
      </div>
      {panel === "tasks" && <TaskPanel onClose={() => setPanel(null)} />}
      {panel === "cfg" && <GenSettings onClose={() => setPanel(null)} />}
      <div className={`dj-stage${view === "f" ? " dj-stage-flow" : ""}`}>
        <JournalStage view={view} sessions={sessions} progress={progress} ym={ym} snap={snap} today={today} openMonth={openMonth} />
      </div>
    </div>
  );
}
