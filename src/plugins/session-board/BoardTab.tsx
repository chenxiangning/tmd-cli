/** 会话看板主视图:工具栏 + 热力月历 + 聚焦日面板(原型 docs/design/session-calendar-heat-agenda.html;
 *  月历网格拆至 CalendarGrid.tsx、工具栏拆至 BoardToolbar.tsx;点格开日视图、← → 逐日、
 *  Esc 收起;引擎/状态 chips 过滤)。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SquaresFour } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useMinSpin } from "@kernel/useMinSpin";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { Empty } from "@kernel/Empty";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { boardOverlayOpen } from "./boardOverlayStore";
import { archiveSession, sessionArchiveKey, unarchiveSession } from "@kernel/sessionArchive";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import {
  dayKeyOf,
  laneOf,
  useBoardSessions,
  type BoardSession,
  type BoardState,
} from "./boardData";
import { CalendarGrid } from "./CalendarGrid";
import { BoardToolbar } from "./BoardToolbar";
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

  const dayOpen = (s: BoardSession) => { /* 点卡只开 tab 不收板;openDiskSession 内部置 active;归档/打开用行自身归属。 */
    host.events.emit(KernelTopics.sessionViewRequested, null);
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
      <BoardToolbar
        list={list}
        allMode={allMode}
        selWsId={selWsId}
        onSelectWs={setSelWsId}
        view={view}
        onPrevMonth={() => {
          setSelDay(null); /* 翻月收日视图:选中日不在视图周会塌全部周(评审 P2) */
          setView(view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 });
        }}
        onNextMonth={() => {
          setSelDay(null);
          setView(view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 });
        }}
        onToday={() => {
          const n = new Date();
          setView({ y: n.getFullYear(), m: n.getMonth() });
          setSelDay(dayKeyOf(n.getTime()));
        }}
        engines={engines}
        engOff={engOff}
        onToggleEngine={(id) => setEngOff((s) => toggleIn(s, id))}
        stOff={stOff}
        onToggleState={(key) => setStOff((s) => toggleIn(s, key))}
        filteredCount={filtered.length}
        newCount={newCount}
        spinning={spinning}
        onRescan={() => spin(() => setRefreshTick((v) => v + 1))}
      />

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
