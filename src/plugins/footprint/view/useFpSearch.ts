/**
 * footprint ⌘K 反查 hook:命中浮层的开合/查询/命中列表/光标 + 跳日消费。
 * 自 FootprintView 拆出守 300 行铁则。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail, FpHit } from "../dataSource";
import { loadDayDetail, searchDays } from "../dataSource";
import { jumpHitTranscript } from "../jumpTranscript";
import type { FileSel } from "./useFpFiles";

export interface FpSearchDeps {
  ym: { y: number; m: number };
  setYm: (ym: { y: number; m: number }) => void;
  setSel: (day: string) => void;
  setRange: (r: [string, string] | null) => void;
  setCard: (c: FpCardView | null) => void;
  setDetail: (d: FpDayDetail) => void;
  setFileSel: (p: FileSel | null) => void;
  openCard: (c: FpCardView) => void;
  /** 清区间起点(跳日后残留 anchor 会让下一次单击莫名完成区间)。 */
  clearAnchor: () => void;
}

/** 返回搜索 UI 态(openSearch/pickHit 给顶栏与浮层),聚焦输入框 ref 一并交出。 */
export function useFpSearch({ ym, setYm, setSel, setRange, setCard, setDetail, setFileSel, openCard, clearAnchor }: FpSearchDeps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FpHit[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /* 「看对话」轻反馈(BatchSheet 同款三态,jumped 静默因幕布已可见) */
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  const jumpTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current);
    },
    [],
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setQuery("");
    setHits(null);
    setCursor(0);
    setJumpNotice(null); /* 重开浮层不残留上一条 opened/miss 文案 */
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
  }, [searchOpen, query]);

  const pickHit = useCallback(
    (h: FpHit) => {
      setSearchOpen(false);
      const d = new Date(`${h.day}T12:00:00`);
      if (d.getFullYear() !== ym.y || d.getMonth() + 1 !== ym.m) setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
      setRange(null);
      clearAnchor();
      setSel(h.day);
      if (h.kind === "card" || h.kind === "quote") {
        void loadDayDetail(h.day).then((dd) => {
          setDetail(dd);
          const hitCard = h.featureId !== undefined ? dd.cards[h.featureId] : undefined;
          if (hitCard) openCard(hitCard);
        });
      } else {
        setCard(null);
      }
      setFileSel(null);
    },
    [ym, setDetail, setFileSel, openCard, setYm, setRange, setSel, setCard, clearAnchor],
  );

  const jumpHit = useCallback((h: FpHit) => {
    void jumpHitTranscript(h).then((outcome) => {
      /* jumped=幕布已定位;opened=幕布未中已落转录查看器(屏幕可见)——都静默 */
      if (outcome !== "miss") return;
      setJumpNotice(t("未能定位到该条对话消息"));
      if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current);
      jumpTimer.current = window.setTimeout(() => setJumpNotice(null), 2600);
    });
  }, []);

  return { searchOpen, setSearchOpen, query, setQuery, hits, cursor, setCursor, searchInputRef, openSearch, pickHit, jumpHit, jumpNotice };
}
