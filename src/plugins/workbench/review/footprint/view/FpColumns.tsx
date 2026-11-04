/**
 * footprint 三栏布局:左月历热力导航 / 中功能卡流+宽 diff 面板 / 右证据抽屉。
 * 宽度可拖:react-resizable-panels 与壳层 DesktopColumns 同库同柄样式
 * (.panel-handle 细线是唯一栏边界,栏体不再自带 border);默认宽 248/余量/340,
 * 关 tab 重开即回默认。挂载闸:容器测出非零宽才挂 Group——0 宽首测会把
 * defaultSize 折算成退化 fr 布局并随宽度等比放大(2026-10-20 实测)。
 */
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail } from "../dataSource";
import { useMeasuredWidth } from "./bits";
import { DayFlow } from "./DayFlow";
import { FpMainDiff } from "./DiffPanel";
import { FpDrawer } from "./EvidenceDrawer";
import { MonthCal, type HeatMode, type MonthCalProps } from "./MonthCal";
import type { FileSel } from "./useFpFiles";

export function FpColumns({
  ym,
  month,
  today,
  sel,
  range,
  rangeDetails,
  dayLoading,
  detail,
  heat,
  anchor,
  card,
  fileSel,
  sessSel,
  searchOpen,
  query,
  focusIdx,
  selectDay,
  anchorDay,
  openCard,
  onFix,
  onManualDigest,
  aiDigest,
  closeDrawer,
  setSessSel,
  pickFile,
  resumeSession,
  openFile,
  revealFile,
  showToast,
}: {
  ym: { y: number; m: number };
  month: MonthCalProps["cells"];
  today: string;
  sel: string;
  range: [string, string] | null;
  rangeDetails: FpDayDetail[];
  dayLoading: boolean;
  detail: FpDayDetail | null;
  heat: HeatMode;
  anchor: string | null;
  card: FpCardView | null;
  fileSel: FileSel | null;
  sessSel: string | null;
  searchOpen: boolean;
  query: string;
  focusIdx: number;
  selectDay: MonthCalProps["onSelectDay"];
  anchorDay: MonthCalProps["onAnchorDay"];
  openCard: (card: FpCardView) => void;
  onFix: (card: FpCardView, rect: DOMRect) => void;
  onManualDigest: () => void;
  aiDigest: () => void;
  closeDrawer: () => void;
  setSessSel: (sid: string | null) => void;
  pickFile: (path: string) => void;
  resumeSession: (sid: string) => void;
  openFile: (path: string, refs: string[]) => void;
  revealFile: (path: string, refs: string[]) => void;
  showToast: (msg: string) => void;
}) {
  const [colsRef, measured] = useMeasuredWidth();
  return (
    <div ref={colsRef} className="min-h-0 flex-1">
      {measured && (
        <PanelGroup orientation="horizontal" id="tmd.footprint" className="h-full">
          <Panel id="fp-cal" defaultSize="248px" minSize="150px">
            <aside className="flex h-full flex-col gap-2 overflow-y-auto py-3">
              <MonthCal y={ym.y} m={ym.m} cells={month} today={today} sel={sel} range={range} heat={heat} onSelectDay={selectDay} onAnchorDay={anchorDay} />
              <div className={`px-4 text-[10.5px] leading-relaxed ${anchor ? "text-[var(--tmd-accent,var(--tmd-accent))]" : "text-[var(--tmd-fg-muted)]"}`}>
                {anchor ? t("区间模式:再点一天完成选择 · 点单日退出") : t("区间模式:shift 点起点再点终点 · 右键同效 · 点单日退出")}
              </div>
            </aside>
          </Panel>
          <PanelResizeHandle className="panel-handle panel-handle-v" />

          <Panel id="fp-main" minSize="30%">
            <main className="flex h-full min-w-0 flex-col">
              <DayFlow
                loading={!range && dayLoading}
                detail={detail ?? { day: sel, rollup: null, cards: [], cardsOrigin: null, aiCards: null, rows: [], article: null, commits: [], scanFailed: false }}
                range={range}
                rangeDetails={rangeDetails}
                query={searchOpen ? query : ""}
                today={today}
                focusIdx={focusIdx}
                onOpenCard={openCard}
                onFix={onFix}
                onManualDigest={onManualDigest}
                onAiDigest={aiDigest}
              />
              <FpMainDiff
                fileSel={card && detail ? fileSel : null}
                onClose={closeDrawer}
                onOpenFile={openFile}
                onRevealFile={revealFile}
                onGitFallback={() => showToast(t("git 跳转:git_repos_log_range 收口后接提交视图"))}
              />
            </main>
          </Panel>

          {card && detail && (
            <>
              <PanelResizeHandle className="panel-handle panel-handle-v" />
              <Panel id="fp-drawer" defaultSize="340px" minSize="200px">
                <FpDrawer
                  card={card}
                  detail={detail}
                  query={searchOpen ? "" : query}
                  selPath={fileSel?.path ?? null}
                  selSess={sessSel}
                  onClose={closeDrawer}
                  onSelectSess={setSessSel}
                  onSelectFile={pickFile}
                  onResumeSession={resumeSession}
                  onOpenFile={openFile}
                  onRevealFile={revealFile}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      )}
    </div>
  );
}
