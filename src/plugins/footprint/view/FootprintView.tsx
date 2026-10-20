/**
 * footprint · 每日工作足迹主视图(v2.1 原型结构):
 * 左月历热力导航 / 中功能卡流+宽 diff 面板 / 右证据抽屉;
 * ⌘K 反查、shift 区间、j/k/t/1/2/? 键盘、live 封口轻刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { EditorTab } from "@kernel/tabs";
import type { FpCardView } from "../dataSource";
import { dayKeyOf } from "../dataSource";
import { reconcileOnce } from "../backfill";
import { useFpSearch } from "./useFpSearch";
import { useFpAiDigest } from "./useFpAiDigest";
import { useFootprintRev, gotoToday, fpInitView } from "../fpTab";
import type { FootprintTabPayload } from "../fpTab";
import { FpColumns } from "./FpColumns";
import { FixModals } from "./FixModals";
import { FpOverlays } from "./FpOverlays";
import { FpTopbar } from "./FpTopbar";
import { type HeatMode } from "./MonthCal";
import { useFpFiles } from "./useFpFiles";
import { useFpDeepLinkJump } from "./useFpDeepLink";
import { useFpSelection } from "./useFpSelection";
import { useFpFix } from "./useFpFix";
import { useFpKeys } from "./useFpKeys";
import { useFpData } from "./useFpData";

export function FootprintView({ tab }: { tab: EditorTab }) {
  const rev = useFootprintRev(); /* ckptTurnSealed → 当日轻刷新 */
  /* 补账:首次打开对本月对账一次(补「应用未运行期间封口」的漏批);补到即 bump 重拉。
   * 不放启动定时:对账要全量会话扫描,叠启动峰会与启动错峰目标冲突。 */
  useEffect(() => {
    void reconcileOnce();
  }, []);
  const now = new Date();
  const today = dayKeyOf(now);
  /* 深链初始:payload.day 直达(journal 轴视图「足迹 ↗」;openTab refresh 已开重开)。 */
  const fpPayload = (tab.payload ?? {}) as FootprintTabPayload;
  const jumpDay = fpPayload.day;
  const initView = fpInitView(jumpDay, today);
  const [ym, setYm] = useState(initView.ym);
  const ymStr = `${ym.y}-${String(ym.m).padStart(2, "0")}`;
  const [sel, setSel] = useState(initView.sel);
  const [range, setRange] = useState<[string, string] | null>(null);
  const [heat, setHeat] = useState<HeatMode>("lines");
  const { month, detail, rangeDetails, dayLoading, setDetail } = useFpData({ ymStr, sel, range, rev });
  const [card, setCard] = useState<FpCardView | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fixCard, setFixCard] = useState<string | null>(null);
  const [fixPos, setFixPos] = useState<{ left: number; top: number } | null>(null);
  const [sessSel, setSessSel] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const { fileSel, setFileSel, pickFile, resumeSession, openFile, revealFile } = useFpFiles(detail, card, showToast);

  /* AI 补归纳:入队工作台日报生成会话(忙守卫与入队链收进 hook)。 */
  const aiDigest = useFpAiDigest({ sel, showToast });

  const { renaming, renameVal, setRenameVal, setRenaming, submitRename,
    dialog, setDialog, submitMerge, submitSplit, submitManual, openFixAction } = useFpFix({
    sel,
    detail,
    showToast,
  });

  /* 选日/区间动作收进 hook(守 300 行铁则与组件复杂度;range 留组件供下游消费) */
  const { anchor, selectDay, anchorDay, resetSelection } = useFpSelection({
    range,
    setRange,
    showToast,
    setSel,
    setCard,
    setFileSel,
    setFocusIdx,
  });

  /* 深链跟跳:已挂期间 payload.day 变更(openTab refresh 刷 payload)→ 退出
   * 区间态跳日并清选中(钩子内 render 期比较,先例 useArticleEditSignal)。 */
  const applyJump = useCallback((day: string, ym: { y: number; m: number }) => {
    setRange(null);
    resetSelection();
    setYm(ym);
    setSel(day);
    setCard(null);
    setFileSel(null);
    setFocusIdx(-1);
  }, [setRange, resetSelection, setFileSel]);
  useFpDeepLinkJump(jumpDay, applyJump);

  const shiftMonth = useCallback((delta: number) => {
    setYm((prev) => {
      const d = new Date(prev.y, prev.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  }, []);

  const openCard = useCallback((c: FpCardView) => {
    setCard(c);
    setFileSel(null);
    setSessSel(c.sessions[0] ?? null);
    setFocusIdx(-1);
  }, [setFileSel]);

  /* ⌘K / 搜索(状态与跳日逻辑收进 hook,守 300 行铁则) */
  const { searchOpen, setSearchOpen, query, setQuery, hits, cursor, setCursor, searchInputRef, openSearch, pickHit } = useFpSearch({
    ym,
    setYm,
    setSel,
    setRange,
    setCard,
    setDetail,
    setFileSel,
    openCard,
    clearAnchor: resetSelection,
  });

  /* 键盘:j/k/t/1/2/?/esc/方向键(容器聚焦期生效,不抢 composer) */
  const onKeyDown = useFpKeys({
    searchOpen,
    helpOpen,
    fixCard,
    card,
    sel,
    cards: range ? rangeDetails.flatMap((d) => d.cards) : (detail?.cards ?? []),
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
    clearAnchor: resetSelection,
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
          resetSelection();
          gotoToday(setYm, setSel);
        }}
        onQuery={setQuery}
        onOpenSearch={openSearch}
        onHeat={setHeat}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />

      {/* 三栏:宽度可拖 + 默认宽 248/余量/340(布局与挂载闸详见 FpColumns 头注) */}
      <FpColumns
        ym={ym}
        month={month}
        today={today}
        sel={sel}
        range={range}
        rangeDetails={rangeDetails}
        dayLoading={dayLoading}
        detail={detail}
        heat={heat}
        anchor={anchor}
        card={card}
        fileSel={fileSel}
        sessSel={sessSel}
        searchOpen={searchOpen}
        query={query}
        focusIdx={focusIdx}
        selectDay={selectDay}
        anchorDay={anchorDay}
        openCard={openCard}
        onFix={(c, rect) => {
          setFixCard(fixCard === c.title ? null : c.title);
          setFixPos({ left: rect.left, top: rect.bottom });
        }}
        onManualDigest={() => setDialog({ kind: "manual" })}
        aiDigest={aiDigest}
        closeDrawer={() => {
          setCard(null);
          setFileSel(null);
        }}
        setSessSel={setSessSel}
        pickFile={pickFile}
        resumeSession={resumeSession}
        openFile={openFile}
        revealFile={revealFile}
        showToast={showToast}
      />

      {/* 弹层们 */}
      <FpOverlays
        searchOpen={searchOpen}
        query={query}
        hits={hits}
        cursor={cursor}
        helpOpen={helpOpen}
        fixCard={fixCard}
        fixPos={fixPos}
        toast={toast}
        searchInputRef={searchInputRef}
        onQuery={setQuery}
        onCursor={setCursor}
        onPickHit={pickHit}
        onCloseSearch={() => setSearchOpen(false)}
        onCloseFix={() => {
          setFixCard(null);
          setFixPos(null);
        }}
        onFixAction={(a) => {
          setFixCard(null);
          setFixPos(null);
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
