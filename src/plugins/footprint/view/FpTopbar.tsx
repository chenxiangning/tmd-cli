/**
 * footprint 顶栏:月份导航 / 回到今日 / 反查输入 / 热力口径 / 快捷键。
 * 自 FootprintView 拆出守 300 行铁则。
 */
import { t } from "@kernel/i18n";
import type { HeatMode } from "./MonthCal";

export interface FpTopbarProps {
  ym: { y: number; m: number };
  heat: HeatMode;
  query: string;
  onShiftMonth: (delta: number) => void;
  onToday: () => void;
  onQuery: (q: string) => void;
  onOpenSearch: () => void;
  onHeat: (mode: HeatMode) => void;
  onToggleHelp: () => void;
}

export function FpTopbar({ ym, heat, query, onShiftMonth, onToday, onQuery, onOpenSearch, onHeat, onToggleHelp }: FpTopbarProps) {
  return (
    <div className="flex flex-none items-center gap-2 border-b border-[var(--tmd-border,#e2e8f0)] px-3 py-2">
      <button type="button" className="rounded-md px-2 py-1 text-[12px] hover:bg-[var(--tmd-surface-2,#f1f5f9)]" onClick={() => onShiftMonth(-1)} title={t("上月(⇧←)")}>
        ‹
      </button>
      <span className="text-[13px] font-bold">{t("{y} 年 {m} 月", { y: ym.y, m: ym.m })}</span>
      <button type="button" className="rounded-md px-2 py-1 text-[12px] hover:bg-[var(--tmd-surface-2,#f1f5f9)]" onClick={() => onShiftMonth(1)} title={t("下月(⇧→)")}>
        ›
      </button>
      <button
        type="button"
        className="rounded-md bg-[var(--tmd-surface-2,#f1f5f9)] px-2 py-1 text-[11.5px] hover:bg-[var(--tmd-surface-3,#e2e8f0)]"
        onClick={onToday}
      >
        {t("回到今日")}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg bg-[var(--tmd-surface-2,#f1f5f9)] px-2 py-1 text-[11.5px] text-[var(--tmd-fg-3,#64748b)]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onFocus={onOpenSearch}
            placeholder={t("反查:账号密码 / 配置文件 / 路径…")}
            className="w-44 bg-transparent outline-none"
          />
          <kbd className="rounded border border-[var(--tmd-border,#e2e8f0)] px-1 text-[10px]">⌘K</kbd>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-[var(--tmd-border,#e2e8f0)] text-[11px]">
          {([["lines", "按改动量"], ["sessions", "按会话数"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`px-2 py-1 ${heat === k ? "bg-[var(--tmd-accent,#2563eb)] text-white" : "hover:bg-[var(--tmd-surface-2,#f1f5f9)]"}`}
              onClick={() => onHeat(k)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <button type="button" className="rounded-md px-2 py-1 text-[13px] text-[var(--tmd-fg-3,#64748b)] hover:bg-[var(--tmd-surface-2,#f1f5f9)]" title={t("快捷键(?)")} onClick={onToggleHelp}>
          ?
        </button>
      </div>
    </div>
  );
}

