/**
 * footprint 键盘语义(j/k/t/1/2/?/esc/方向键/⌘K,原型 v2.1 键位表)。
 * 自 FootprintView 拆出守 300 行铁则;容器聚焦期生效,不抢输入框。
 */
import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import { dayKeyOf } from "../dataSource";
import type { FpCardView, FpDayDetail } from "../dataSource";
import type { HeatMode } from "./MonthCal";

export interface FpKeysParams {
  searchOpen: boolean;
  helpOpen: boolean;
  fixCard: string | null;
  card: FpCardView | null;
  sel: string;
  detail: FpDayDetail | null;
  focusIdx: number;
  openSearch: () => void;
  closeSearch: () => void;
  setHelpOpen: (updater: (v: boolean) => boolean) => void;
  setFixCard: (v: string | null) => void;
  setCard: (c: FpCardView | null) => void;
  setFileSel: (v: null) => void;
  setSearchOpen: (v: boolean) => void;
  setFocusIdx: (updater: (prev: number) => number) => void;
  setYm: (ym: { y: number; m: number }) => void;
  setSel: (day: string) => void;
  setRange: (r: [string, string] | null) => void;
  setHeat: (mode: HeatMode) => void;
  shiftMonth: (delta: number) => void;
  selectDay: (day: string, shift: boolean) => void;
  openCard: (c: FpCardView) => void;
}

export function useFpKeys(p: FpKeysParams): (e: KeyboardEvent) => void {
  return useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        p.openSearch();
        return;
      }
      if (e.key === "Escape") {
        if (p.searchOpen) p.setSearchOpen(false);
        else if (p.helpOpen) p.setHelpOpen((v) => !v);
        else if (p.fixCard) p.setFixCard(null);
        else if (p.card) {
          p.setCard(null);
          p.setFileSel(null);
        }
        return;
      }
      if (p.searchOpen || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) {
          p.shiftMonth(e.key === "ArrowLeft" ? -1 : 1);
          return;
        }
        const d = new Date(`${p.sel}T12:00:00`);
        d.setDate(d.getDate() + (e.key === "ArrowLeft" ? -1 : 1));
        p.selectDay(dayKeyOf(d), false);
      } else if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const n = p.detail?.cards.length ?? 0;
        if (n === 0) return;
        p.setFocusIdx((prev) => (prev < 0 ? 0 : Math.max(0, Math.min(n - 1, e.key === "j" ? prev + 1 : prev - 1))));
      } else if (e.key === "Enter" && p.focusIdx >= 0 && p.detail?.cards[p.focusIdx]) {
        p.openCard(p.detail.cards[p.focusIdx]);
      } else if (e.key === "t") {
        p.setRange(null);
        const d = new Date();
        p.setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
        p.setSel(dayKeyOf(d));
      } else if (e.key === "1") p.setHeat("lines");
      else if (e.key === "2") p.setHeat("sessions");
      else if (e.key === "?") p.setHelpOpen((v) => !v);
    },
    [p],
  );
}
