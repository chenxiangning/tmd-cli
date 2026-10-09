/** 会话看板主视图:工具栏 + 热力月历 + 聚焦日面板(原型 docs/design/session-calendar-heat-agenda.html;
 *  月历网格拆至 CalendarGrid.tsx;点格开日视图、← → 逐日、Esc 收起;引擎/状态 chips 过滤)。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, ArrowClockwise, SquaresFour, X } from "@phosphor-icons/react";
import { closeBoardOverlay } from "./boardOverlayStore";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { useMinSpin } from "@kernel/useMinSpin";
import { host } from "@kernel/host";
import { Empty } from "@kernel/Empty";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { workspaceDisplayName, useWorkspaces } from "@kernel/workspace";
import { boardOverlayOpen } from "./boardOverlayStore";
import { archiveSession, sessionArchiveKey, unarchiveSession } from "@kernel/sessionArchive";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import {
  BOARD_LANES,
  dayKeyOf,
  engineColor,
  laneOf,
  monthTitle,
  useBoardSessions,
  type BoardSession,
  type BoardState,
} from "./boardData";
import { CalendarGrid, HeatLegend } from "./CalendarGrid";
import { DayPanel } from "./DayPanel";
import { ScanErrorBar } from "./ScanErrorBar";
import "./session-board.css";

/** 集 immutable 翻转:引擎/状态 chips 过滤共用(2026-10-04 抽出守 300 行铁则)。 */
function toggleIn<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
}

export function BoardTab() {
  const { list } = useWorkspaces();
  /* 工作区选择:默认「全部」;单选可聚焦。远程工作区仅本机磁盘视图不支持。 */
  const [selWsId, setSelWsId] = useState<string>("all");
  const allMode = selWsId === "all";
  const selWs = allMode ? undefined : list.find((w) => w.id === selWsId);
  const targetWs = useMemo(
    () => (allMode ? list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec) : selWs ? [selWs] : []),
    [allMode, list, selWs],
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const scan = useBoardSessions(targetWs, allMode, refreshTick);
  const { spinning, spin } = useMinSpin();
  const sessions = scan?.rows ?? null;
  const failedEngines = scan?.failedEngines ?? [];
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selDay, setSelDay] = useState<string | null>(null);
  const [engOff, setEngOff] = useState<ReadonlySet<string>>(new Set());
  const [stOff, setStOff] = useState<ReadonlySet<BoardState>>(new Set());
  /* 轻反馈 toast(本面板局部,PluginMarketPage 同款模式)。 */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1900);
  };
  const engines = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; n: number }>();
    for (const s of sessions ?? []) {
      const cur = byId.get(s.profileId);
      if (cur) cur.n++;
      else byId.set(s.profileId, { id: s.profileId, name: s.profile.name, n: 1 });
    }
    return [...byId.values()].sort((a, b) => b.n - a.n);
  }, [sessions]);

  const filtered = useMemo(
    () => sessions?.filter((s) => !engOff.has(s.profileId) && !stOff.has(laneOf(s.st))) ?? [],
    [sessions, engOff, stOff],
  );

  /* 双日落位:创建日(定死)+ 最近活跃日(若不同),两类用户诉求同时满足。 */
  const byDay = useMemo(() => {
    const map = new Map<string, BoardSession[]>();
    const push = (k: string, s: BoardSession) => {
      const arr = map.get(k);
      if (arr) arr.push(s); else map.set(k, [s]);
    };
    for (const s of filtered) {
      const born = dayKeyOf(s.ts);
      push(born, s);
      const active = dayKeyOf(s.activeTs);
      if (active !== born) push(active, s);
    }
    return map;
  }, [filtered]);

  /* 点卡只开 tab 不收板;openDiskSession 内部置 active;归档/打开用行自身归属。 */
  const dayOpen = (s: BoardSession) => {
    if (s.live && s.hostId) {
      noteSessionTabTitle(s.hostId, s.title);
      host.setActiveSession(s.hostId);
      return;
    }
    if (!s.wsId || !s.disk) return;
    const key = sessionArchiveKey(s.wsId, s.profileId, s.disk.id);
    if (s.st === "ended-new") archiveSession(key);
    /* 打开失败回滚归档,防注意力信号静默丢失。 */
    host.openDiskSession(s.profileId, s.wsRoot, s.wsId, s.disk.id).catch(() => s.st === "ended-new" && void unarchiveSession(key));
  };
  /* ← → 逐日 / Esc 收起(覆盖层开着时接管,Esc 先收日视图再收板)。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* 输入面拥有按键时不劫持 ← → Esc。 */
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      if (!boardOverlayOpen() || !selDay) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        const [y, m, d] = selDay.split("-").map(Number);
        const next = new Date(y, m, d + dir);
        setView({ y: next.getFullYear(), m: next.getMonth() });
        setSelDay(dayKeyOf(next.getTime()));
      } else if (e.key === "Escape") {
        setSelDay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selDay]);

  if (list.length === 0) {
    /* 无导航路径直达「添加工作区」浮层,无 action。 */
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={<SquaresFour />}>{t("暂无工作区")}</Empty>
      </div>);
  }
  if (!allMode && selWs && findWorkspaceOrigin(selWs)?.remoteExec) {
    /* 远程工作区磁盘在远端:显式空态不静默。 */
    return <div className="sb-empty">{t("远程工作区暂不支持看板(仅本机磁盘)")}</div>;
  }

  const newCount = filtered.filter((s) => s.st === "ended-new").length;

  return (
    <div className="sb-root">
      <div className="sb-toolbar">
        {/* 左上 × 收板(覆盖层盖住左 rail 后的顺手位,与市场页同位);右端 × 保留。 */}
        <button type="button" className="sb-btn" aria-label={t("关闭看板")} title={t("关闭看板")} onClick={closeBoardOverlay}>
          <X size="0.875rem" aria-hidden />
        </button>
        <span className="sb-chips" role="group" aria-label={t("工作区")}>
          <button
            type="button"
            className={`sb-chip${allMode ? " on" : ""}`}
            aria-pressed={allMode}
            onClick={() => setSelWsId("all")}
          >
            {t("全部工作区")}
          </button>
          {list.map((w) => {
            const on = selWsId === w.id;
            return (
              <button
                key={w.id}
                type="button"
                className={`sb-chip${on ? " on" : ""}`}
                aria-pressed={on}
                title={w.root}
                onClick={() => setSelWsId(w.id)}
              >
                {workspaceDisplayName(w)}
              </button>
            );
          })}
        </span>
        <span className="sb-nav">
          <button
            type="button"
            className="sb-btn"
            aria-label={t("上个月")}
            onClick={() => {
              setSelDay(null); /* 翻月收日视图:选中日不在视图周会塌全部周(评审 P2) */
              setView(view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 });
            }}
          >
            <CaretLeft size="0.875rem" aria-hidden />
          </button>
          <span className="sb-month">{monthTitle(view.y, view.m)}</span>
          <button
            type="button"
            className="sb-btn"
            aria-label={t("下个月")}
            onClick={() => {
              setSelDay(null);
              setView(view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 });
            }}
          >
            <CaretRight size="0.875rem" aria-hidden />
          </button>
          <button
            type="button"
            className="sb-btn sb-today"
            onClick={() => {
              const n = new Date();
              setView({ y: n.getFullYear(), m: n.getMonth() });
              setSelDay(dayKeyOf(n.getTime()));
            }}
          >
            {t("今天")}
          </button>
        </span>
        <span className="sb-chips" role="group" aria-label={t("引擎过滤")}>
          {engines.map((e) => {
            const on = !engOff.has(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className={`sb-chip${on ? " on" : ""}`}
                style={{ "--ec": engineColor(e.id) } as React.CSSProperties}
                aria-pressed={on}
                title={`${e.name} · ${e.n}`}
                onClick={() => setEngOff(toggleIn(engOff, e.id))}
              >
                <span className="sb-chip-dot" aria-hidden />
                {e.name}
              </button>
            );
          })}
        </span>
        <span className="sb-chips" role="group" aria-label={t("状态过滤")}>
          {BOARD_LANES.map(({ key, label }) => {
            const on = !stOff.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`sb-chip${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => setStOff(toggleIn(stOff, key))}
              >
                {t(label)}
              </button>
            );
          })}
        </span>
        <HeatLegend />
        <span className="sb-toolbar-end">
          <span className="sb-count" title={t("未查看 = 结束未归档且 14 天内有活动")}>
            {t("{n} 个会话", { n: filtered.length })} · {t("{n} 个未查看", { n: newCount })}</span>
          <button
            type="button"
            className="sb-btn"
            aria-label={t("重新扫描")}
            title={t("重新扫描")}
            onClick={() => spin(() => setRefreshTick((v) => v + 1))}
          >
            {spinning ? <Spinner size="0.875rem" /> : <ArrowClockwise size="0.875rem" aria-hidden />}
          </button>
          <button type="button" className="sb-btn" aria-label={t("关闭看板")} title={t("关闭看板")} onClick={closeBoardOverlay}>
            <X size="0.875rem" aria-hidden />
          </button>
        </span>
      </div>

      {failedEngines.length > 0 ? (
        <ScanErrorBar failedEngines={failedEngines} onRetry={() => setRefreshTick((v) => v + 1)} />
      ) : null}

      {sessions === null ? (
        /* 工作区切换后的首扫:显式扫描态,不渲染空板 + 0 计数(评审 P3)。 */
        <div className="sb-empty" style={{ flex: 1 }}>{t("正在扫描会话…")}</div>
      ) : (
        <>
          <CalendarGrid view={view} byDay={byDay} selDay={selDay} onSelect={setSelDay} />

          {selDay && (
            <DayPanel
              dayKey={selDay}
              sessions={byDay.get(selDay) ?? []}
              showWs={allMode}
              onOpen={dayOpen}
              onClose={() => setSelDay(null)}
              onNotice={showToast}
            />
          )}
        </>
      )}
      <div className={`sb-toast${toast ? " show" : ""}`} role="status">
        {toast}
      </div>
    </div>
  );
}
