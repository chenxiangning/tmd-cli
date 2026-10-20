/** 看板工具栏(工作区 chips / 月导航 / 引擎与状态过滤 / 计数与重扫)——
 * 2026-10-20 从 BoardTab.tsx 拆出的展示组件(守 300 行铁则,零语义改动);
 * 状态所有权仍在 BoardTab,本组件只收回调。
 */
import type { CSSProperties } from "react";
import { CaretLeft, CaretRight, ArrowClockwise, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { workspaceDisplayName, type Workspace } from "@kernel/workspace";
import { BOARD_LANES, engineColor, monthTitle, type BoardState } from "./boardData";
import { HeatLegend } from "./CalendarGrid";
import { closeBoardOverlay } from "./boardOverlayStore";

export interface BoardToolbarProps {
  list: Workspace[];
  allMode: boolean;
  selWsId: string;
  onSelectWs: (id: string) => void;
  view: { y: number; m: number };
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  engines: { id: string; name: string; n: number }[];
  engOff: ReadonlySet<string>;
  onToggleEngine: (id: string) => void;
  stOff: ReadonlySet<BoardState>;
  onToggleState: (key: BoardState) => void;
  filteredCount: number;
  newCount: number;
  spinning: boolean;
  onRescan: () => void;
}

export function BoardToolbar({
  list,
  allMode,
  selWsId,
  onSelectWs,
  view,
  onPrevMonth,
  onNextMonth,
  onToday,
  engines,
  engOff,
  onToggleEngine,
  stOff,
  onToggleState,
  filteredCount,
  newCount,
  spinning,
  onRescan,
}: BoardToolbarProps) {
  return (
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
          onClick={() => onSelectWs("all")}
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
              onClick={() => onSelectWs(w.id)}
            >
              {workspaceDisplayName(w)}
            </button>
          );
        })}
      </span>
      <span className="sb-nav">
        <button type="button" className="sb-btn" aria-label={t("上个月")} onClick={onPrevMonth}>
          <CaretLeft size="0.875rem" aria-hidden />
        </button>
        <span className="sb-month">{monthTitle(view.y, view.m)}</span>
        <button type="button" className="sb-btn" aria-label={t("下个月")} onClick={onNextMonth}>
          <CaretRight size="0.875rem" aria-hidden />
        </button>
        <button type="button" className="sb-btn sb-today" onClick={onToday}>
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
              style={{ "--ec": engineColor(e.id) } as CSSProperties}
              aria-pressed={on}
              title={`${e.name} · ${e.n}`}
              onClick={() => onToggleEngine(e.id)}
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
              onClick={() => onToggleState(key)}
            >
              {t(label)}
            </button>
          );
        })}
      </span>
      <HeatLegend />
      <span className="sb-toolbar-end">
        <span className="sb-count" title={t("未查看 = 结束未归档且 14 天内有活动")}>
          {t("{n} 个会话", { n: filteredCount })} · {t("{n} 个未查看", { n: newCount })}</span>
        <button
          type="button"
          className="sb-btn"
          aria-label={t("重新扫描")}
          title={t("重新扫描")}
          onClick={onRescan}
        >
          {spinning ? <Spinner size="0.875rem" /> : <ArrowClockwise size="0.875rem" aria-hidden />}
        </button>
        <button type="button" className="sb-btn" aria-label={t("关闭看板")} title={t("关闭看板")} onClick={closeBoardOverlay}>
          <X size="0.875rem" aria-hidden />
        </button>
      </span>
    </div>
  );
}
