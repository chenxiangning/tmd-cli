/**
 * footprint ⌘K 反查弹层:功能卡/用户原话/日报/文件路径四来源命中卡,
 * ↑↓ 选择、回车跳转到当日(可带卡定位)。
 */
import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import type { FpHit, SearchKind } from "../dataSource";
import { fpHitJumpable } from "../jumpTranscript";
import { Hi } from "./bits";

const KIND_CLS: Record<SearchKind, string> = {
  card: "bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] text-[var(--tmd-accent,var(--tmd-accent))]",
  quote: "bg-[color-mix(in_srgb,var(--tmd-syntax-tag)_12%,transparent)] text-[var(--tmd-syntax-tag)]",
  article: "bg-[color-mix(in_srgb,var(--tmd-syntax-tag)_12%,transparent)] text-[var(--tmd-syntax-tag)]",
  path: "bg-[var(--tmd-bg-hover)] text-[var(--tmd-fg)] font-mono",
};

const KIND_LABEL: Record<SearchKind, string> = {
  card: "功能卡",
  quote: "原话",
  article: "日报",
  path: "路径",
};

/** 分组头(原型 sp-group);数据源已按 kind 稳定归并,组名变化处插标题。 */
const KIND_GROUP: Record<SearchKind, string> = {
  card: "功能卡",
  quote: "用户原话",
  article: "日报",
  path: "文件路径",
};

export interface SearchPopProps {
  open: boolean;
  query: string;
  hits: FpHit[] | null;
  cursor: number;
  onQuery: (q: string) => void;
  onCursor: (i: number) => void;
  onPick: (hit: FpHit) => void;
  /** 「看对话」:原话逐字文本经 kernel 时序桥跳转录(checkpoints 同款语义)。 */
  onJumpHit: (hit: FpHit) => void;
  /** 跳转轻反馈:opened/miss 短暂回显;null 隐藏。 */
  jumpNotice: string | null;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function SearchPop({ open, query, hits, cursor, onQuery, onCursor, onPick, onJumpHit, jumpNotice, onClose, inputRef }: SearchPopProps) {
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
          query.trim() === "" ? (
            <div className="p-6 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">
              {t("输入关键词,从功能卡 / 日报 / 用户原话 / 文件路径四个来源反查历史")}
            </div>
          ) : (
            <div className="p-6 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">{t("建索引中…")}</div>
          )
        ) : hits.length === 0 ? (
          <div className="p-6 text-center text-[12.5px] text-[var(--tmd-fg-muted)]">{t("无命中")}</div>
        ) : (
          hits.map((h, i) => {
            const prevKind = i > 0 ? hits[i - 1].kind : null;
            return (
              <div key={`${h.day}:${h.kind}:${h.featureId ?? h.snippet.slice(0, 24)}`}>
                {prevKind !== h.kind && (
                  <div className="px-2.5 pt-2 pb-0.5 text-[10.5px] font-bold tracking-wide text-[var(--tmd-fg-muted)]">
                    {t(KIND_GROUP[h.kind])}
                  </div>
                )}
                {/* 行容器持 data-i/hover/选中底;主按钮跳日,可跳原话另给「看对话」
                    平级钮(按钮不嵌套;键盘 Tab/focus-within 与 hover 同样现身) */}
                <div
                  data-i={i}
                  className={`group flex items-center rounded-lg ${i === cursor ? "bg-[var(--tmd-bg-hover)]" : ""}`}
                  onMouseEnter={() => onCursor(i)}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer rounded-lg border-0 p-0 text-left"
                    onClick={() => onPick(h)}
                  >
                    <span className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                      <span className={`flex-none rounded px-1.5 py-px text-[9.5px] font-bold ${KIND_CLS[h.kind]}`}>{t(KIND_LABEL[h.kind])}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <Hi text={h.snippet} q={query} />
                      </span>
                      <span className="flex-none text-[10.5px] text-[var(--tmd-fg-muted)] tabular-nums">{h.day.slice(5)}</span>
                    </span>
                  </button>
                  {fpHitJumpable(h) && (
                    <button
                      type="button"
                      title={t("定位这轮消息在对话中的位置(已结束的会话会先恢复再定位)")}
                      className="mr-1.5 flex-none rounded border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-input)] px-1.5 py-px text-[10.5px] leading-4 text-[var(--tmd-accent,var(--tmd-accent))] opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                      onClick={() => onJumpHit(h)}
                    >
                      {t("看对话")}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex gap-3.5 border-t border-[var(--tmd-border,var(--tmd-border))] px-3.5 py-2 text-[10.5px] text-[var(--tmd-fg-muted)]">
        <span>↑↓ {t("选择")}</span>
        <span>↵ {t("跳转到当日")}</span>
        <span>esc {t("关闭")}</span>
        {jumpNotice && <span className="ml-auto text-[var(--tmd-warn,var(--tmd-warn))]">{jumpNotice}</span>}
      </div>
    </div>
  );
}
