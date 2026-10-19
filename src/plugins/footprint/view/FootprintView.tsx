/**
 * footprint · 每日工作足迹主视图(v2.1 原型结构):
 * 左月历热力导航 / 中功能卡流+宽 diff 面板 / 右证据抽屉;
 * ⌘K 反查、shift 区间、j/k/t/1/2/? 键盘、live 封口轻刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView, FpHit } from "../dataSource";
import { dayKeyOf, loadDayDetail, searchDays } from "../dataSource";
import { useFootprintRev, gotoToday } from "../fpTab";
import { DayFlow } from "./DayFlow";
import { DiffPanel } from "./DiffPanel";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { FixModals } from "./FixModals";
import { FpOverlays } from "./FpOverlays";
import { FpTopbar } from "./FpTopbar";
import { MonthCal, type HeatMode } from "./MonthCal";
import { useFpFiles } from "./useFpFiles";
import { useFpFix } from "./useFpFix";
import { useFpKeys } from "./useFpKeys";
import { useFpData } from "./useFpData";

export function FootprintView() {
  const rev = useFootprintRev(); /* ckptTurnSealed → 当日轻刷新 */
  const now = new Date();
  const today = dayKeyOf(now);
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const ymStr = `${ym.y}-${String(ym.m).padStart(2, "0")}`;
  const [sel, setSel] = useState(today);
  const [range, setRange] = useState<[string, string] | null>(null);
  const anchorRef = useRef<string | null>(null);
  const [heat, setHeat] = useState<HeatMode>("lines");
  const { month, detail, rangeDetails, setDetail } = useFpData({ ymStr, sel, range, rev });
  const [card, setCard] = useState<FpCardView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FpHit[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fixCard, setFixCard] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const { fileSel, setFileSel, pickFile, resumeSession, openFile, revealFile } = useFpFiles(detail, card, showToast);

  const { renaming, renameVal, setRenameVal, setRenaming, submitRename,
    dialog, setDialog, submitMerge, submitSplit, submitManual, openFixAction } = useFpFix({
    sel,
    detail,
    showToast,
  });

  const shiftMonth = useCallback((delta: number) => {
    setYm((prev) => {
      const d = new Date(prev.y, prev.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  }, []);

  const selectDay = useCallback(
    (day: string, shift: boolean) => {
      /* 区间中点单日 = 退出区间进当日(原型语义) */
      if (range) {
        setRange(null);
        anchorRef.current = null;
      } else if (shift && anchorRef.current) {
        const a = anchorRef.current;
        setRange(a <= day ? [a, day] : [day, a]);
        anchorRef.current = null;
        setCard(null);
        setFileSel(null);
        return;
      } else if (shift) {
        anchorRef.current = day;
        showToast(t("已选区间起点 {day}", { day }));
        return;
      }
      anchorRef.current = null;
      setSel(day);
      setCard(null);
      setFileSel(null);
      setFocusIdx(-1);
    },
    [range, showToast, setFileSel],
  );

  const anchorDay = useCallback(
    (day: string) => {
      anchorRef.current = day;
      showToast(t("已选区间起点 {day}", { day }));
    },
    [showToast],
  );

  const openCard = useCallback((c: FpCardView) => {
    setCard(c);
    setFileSel(null);
  }, [setFileSel]);

  /* ⌘K / 搜索 */
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setQuery("");
    setHits(null);
    setCursor(0);
    window.setTimeout(() => searchInputRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    if (!searchOpen || query.trim() === "") {
      if (searchOpen && query.trim() === "") setHits([]);
      return;
    }
    let alive = true;
    void searchDays(query).then((hs) => {
      if (alive) {
        setHits(hs);
        setCursor(0);
      }
    });
    return () => {
      alive = false;
    };
  }, [searchOpen, query, ymStr]);

  const pickHit = useCallback(
    (h: FpHit) => {
      setSearchOpen(false);
      const d = new Date(`${h.day}T12:00:00`);
      if (d.getFullYear() !== ym.y || d.getMonth() + 1 !== ym.m) setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
      setRange(null);
      setSel(h.day);
      if (h.kind === "card" || h.kind === "quote") {
        void loadDayDetail(h.day).then((dd) => {
          setDetail(dd);
          const hitCard = h.featureId !== undefined ? dd.cards[h.featureId] : undefined;
          if (hitCard) setCard(hitCard);
        });
      } else {
        setCard(null);
      }
      setFileSel(null);
    },
    [ym, setDetail, setFileSel],
  );

  /* 键盘:j/k/t/1/2/?/esc/方向键(容器聚焦期生效,不抢 composer) */
  const onKeyDown = useFpKeys({
    searchOpen,
    helpOpen,
    fixCard,
    card,
    sel,
    detail,
    focusIdx,
    openSearch,
    closeSearch: () => setSearchOpen(false),
    setHelpOpen,
    setFixCard,
    setCard,
    setFileSel,
    setSearchOpen,
    setFocusIdx,
    setYm,
    setSel,
    setRange,
    setHeat,
    shiftMonth,
    selectDay,
    openCard,
  });

  return (
    <div role="group" aria-label={t("每日工作足迹")} className="relative flex h-full min-h-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {/* 顶栏 */}
      <FpTopbar
        ym={ym}
        heat={heat}
        query={query}
        onShiftMonth={shiftMonth}
        onToday={() => {
          setRange(null);
          anchorRef.current = null;
          gotoToday(setYm, setSel);
        }}
        onQuery={setQuery}
        onOpenSearch={openSearch}
        onHeat={setHeat}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />

      {/* 三栏 */}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[248px] flex-none flex-col gap-2 overflow-y-auto border-r border-[var(--tmd-border,var(--tmd-border))] py-3">
          <MonthCal y={ym.y} m={ym.m} cells={month} today={today} sel={sel} range={range} heat={heat} onSelectDay={selectDay} onAnchorDay={anchorDay} />
          <div className="px-4 text-[10.5px] leading-relaxed text-[var(--tmd-fg-muted)]">
            {t("区间模式:shift 点起点再点终点 · 右键同效 · 点单日退出")}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <DayFlow
            detail={detail ?? { day: sel, rollup: null, cards: [], rows: [], article: null, digest: null, commits: [], scanFailed: false }}
            range={range}
            rangeDetails={rangeDetails}
            query={searchOpen ? query : ""}
            today={today}
            focusIdx={focusIdx}
            fixCardTitle={fixCard}
            onOpenCard={openCard}
            onFix={(c) => setFixCard(fixCard === c.title ? null : c.title)}
            onManualDigest={() => setDialog({ kind: "manual" })}
          />
          {/* 主流宽 diff 面板(点抽屉文件行展开) */}
          <div id="fp-main-diff" className="px-4">
            {card && fileSel && detail && (
              <DiffPanel
                path={fileSel.path}
                patch={fileSel.patch}
                loading={fileSel.loading}
                degraded={fileSel.degraded}
                engine={fileSel.engine}
                add={fileSel.add}
                del={fileSel.del}
                onOpen={() => openFile(fileSel.path)}
                onReveal={() => revealFile(fileSel.path)}
                onClose={() => setFileSel(null)}
                onGitFallback={() => showToast(t("git 跳转:git_repos_log_range 收口后接提交视图"))}
              />
            )}
          </div>
        </main>

        <aside className="flex w-[340px] flex-none flex-col border-l border-[var(--tmd-border,var(--tmd-border))]">
          {card && detail ? (
            <EvidenceDrawer
              card={card}
              detail={detail}
              query={searchOpen ? "" : query}
              selPath={fileSel?.path ?? null}
              onSelectFile={pickFile}
              onResumeSession={resumeSession}
              onOpenFile={openFile}
              onRevealFile={revealFile}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-[var(--tmd-fg-muted)]">
              {t("点功能卡打开证据抽屉:会话 resume / 文件清单 / diff")}
            </div>
          )}
        </aside>
      </div>

      {/* 弹层们 */}
      <FpOverlays
        searchOpen={searchOpen}
        query={query}
        hits={hits}
        cursor={cursor}
        helpOpen={helpOpen}
        fixCard={fixCard}
        toast={toast}
        searchInputRef={searchInputRef}
        onQuery={setQuery}
        onCursor={setCursor}
        onPickHit={pickHit}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseFix={() => setFixCard(null)}
        onFixAction={(a) => {
          setFixCard(null);
          openFixAction(a, fixCard);
        }}
        renameOpen={renaming !== null}
        renameValue={renameVal}
        onRenameValue={setRenameVal}
        onRenameSubmit={submitRename}
        onRenameCancel={() => setRenaming(null)}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />
      <FixModals
        dialog={dialog}
        detail={detail}
        onMerge={submitMerge}
        onSplit={submitSplit}
        onManual={submitManual}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
