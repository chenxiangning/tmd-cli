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
    <div className="flex flex-none items-center gap-2 border-b border-[var(--tmd-border,var(--tmd-border))] px-3 py-2">
      <span className="flex items-center gap-2 text-[13.5px] font-semibold whitespace-nowrap">
        <i className="h-2 w-2 rounded-full bg-[var(--tmd-accent,var(--tmd-accent))]" />
        {t("每日工作足迹")}
      </span>
      <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--tmd-fg-muted)] hover:bg-[var(--tmd-bg-hover)] hover:text-[var(--tmd-fg)]" onClick={() => onShiftMonth(-1)} title={t("上月(⇧←)")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span className="min-w-24 text-center text-[13.5px] font-semibold">{t("{y} 年 {m} 月", { y: ym.y, m: ym.m })}</span>
      <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--tmd-fg-muted)] hover:bg-[var(--tmd-bg-hover)] hover:text-[var(--tmd-fg)]" onClick={() => onShiftMonth(1)} title={t("下月(⇧→)")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        className="rounded-md px-2.5 py-1 text-[12px] whitespace-nowrap text-[var(--tmd-accent,var(--tmd-accent))] hover:bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))]"
        onClick={onToday}
      >
        {t("回到今日")}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <div className="flex flex-none items-center gap-1.5 rounded-lg bg-[var(--tmd-bg-hover)] px-2 py-1 text-[11.5px] text-[var(--tmd-fg-muted)]">
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
          <kbd className="rounded border border-[var(--tmd-border,var(--tmd-border))] px-1 text-[10px]">⌘K</kbd>
        </div>
        <div className="flex flex-none whitespace-nowrap rounded-lg border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-hover)] p-0.5 text-[11px]">
          {([["lines", "按改动量"], ["sessions", "按会话数"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`whitespace-nowrap rounded-md px-2.5 py-1 ${heat === k ? "bg-[var(--tmd-bg-panel)] font-semibold shadow-sm" : "text-[var(--tmd-fg-muted)] hover:text-[var(--tmd-fg)]"}`}
              onClick={() => onHeat(k)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--tmd-fg-muted)] hover:bg-[var(--tmd-bg-hover)] hover:text-[var(--tmd-fg)]" title={t("快捷键(?)")} onClick={onToggleHelp}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.3a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.8" />
            <circle cx="12" cy="17" r=".6" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

