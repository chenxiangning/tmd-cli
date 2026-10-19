/**
 * footprint ⌘K 反查弹层:功能卡/用户原话/日报/文件路径四来源命中卡,
 * ↑↓ 选择、回车跳转到当日(可带卡定位)。
 */
import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import type { FpHit, SearchKind } from "../dataSource";

const KIND_CLS: Record<SearchKind, string> = {
  card: "bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] text-[var(--tmd-accent,var(--tmd-accent))]",
  quote: "bg-[var(--tmd-violet-weak,var(--tmd-accent-soft))] text-violet-600",
  article: "bg-[var(--tmd-violet-weak,var(--tmd-accent-soft))] text-violet-600",
  path: "bg-[var(--tmd-bg-hover)] text-[var(--tmd-fg)] font-mono",
};

const KIND_LABEL: Record<SearchKind, string> = {
  card: "功能卡",
  quote: "原话",
  article: "日报",
  path: "路径",
};

export interface SearchPopProps {
  open: boolean;
  query: string;
  hits: FpHit[] | null;
  cursor: number;
  onQuery: (q: string) => void;
  onCursor: (i: number) => void;
  onPick: (hit: FpHit) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function SearchPop({ open, query, hits, cursor, onQuery, onCursor, onPick, onClose, inputRef }: SearchPopProps) {
  const listRef = useRef<HTMLDivElement>(null);

  /* 光标随 hits 变化跟随滚动可视 */
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, hits]);

  if (!open) return null;
  return (
    <div className="absolute top-3 left-1/2 z-40 w-[560px] max-w-[calc(100%-40px)] -translate-x-1/2 rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] shadow-lg">
      <div className="flex items-center gap-2 border-b border-[var(--tmd-border,var(--tmd-border))] px-3.5 py-3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none text-[var(--tmd-fg-muted)]">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (hits && hits.length > 0) onCursor((cursor + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (hits && hits.length > 0) onCursor((cursor - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (hits && hits[cursor]) onPick(hits[cursor]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={t("输入关键词反查历史:功能卡 / 日报 / 文件路径")}
          className="flex-1 bg-transparent text-[13.5px] outline-none"
        />
      </div>
      <div ref={listRef} className="max-h-[420px] overflow-y-auto p-1.5">
        {hits === null ? (
          <div className="p-6 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">{t("建索引中…")}</div>
        ) : hits.length === 0 ? (
          <div className="p-6 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">{t("无命中")}</div>
        ) : (
          hits.map((h, i) => (
            <button
              type="button"
              key={`${h.day}:${h.kind}:${h.featureId ?? h.snippet.slice(0, 24)}`}
              data-i={i}
              className={`block w-full cursor-pointer rounded-lg border-0 p-0 text-left ${i === cursor ? "bg-[var(--tmd-bg-hover)]" : ""}`}
              onMouseEnter={() => onCursor(i)}
              onClick={() => onPick(h)}
            >
              <span className={`flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]`}>
                <span className={`flex-none rounded px-1.5 py-px text-[9.5px] font-bold ${KIND_CLS[h.kind]}`}>{t(KIND_LABEL[h.kind])}</span>
                <span className="min-w-0 flex-1 truncate">{h.snippet}</span>
                <span className="flex-none text-[10.5px] text-[var(--tmd-fg-muted)]">{h.day}</span>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="flex gap-3.5 border-t border-[var(--tmd-border,var(--tmd-border))] px-3.5 py-2 text-[10.5px] text-[var(--tmd-fg-muted)]">
        <span>↑↓ {t("选择")}</span>
        <span>↵ {t("跳转到当日")}</span>
        <span>esc {t("关闭")}</span>
      </div>
    </div>
  );
}
