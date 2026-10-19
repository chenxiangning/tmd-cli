/**
 * footprint 弹层群:⌘K 反查 / 快捷键浮层 / 修正菜单 / toast。
 * 自 FootprintView 拆出守 300 行铁则。
 */
import { t } from "@kernel/i18n";
import type { FpHit } from "../dataSource";
import { SearchPop } from "./SearchPop";
import { FIX_ACTIONS } from "./fixActions";

const HELP_ROWS: [string, string][] = [
  ["切换日期", "← →"],
  ["卡片间移动 / 打开", "j k ↵"],
  ["回到今日", "t"],
  ["切换热力口径", "1 2"],
  ["反查搜索", "⌘K"],
  ["关闭抽屉/弹层", "esc"],
];

export interface FpOverlaysProps {
  searchOpen: boolean;
  query: string;
  hits: FpHit[] | null;
  cursor: number;
  helpOpen: boolean;
  fixCard: string | null;
  /** 修正菜单定位(修正按钮 rect);null = 不显示。 */
  fixPos: { left: number; top: number } | null;
  toast: string | null;
  renameOpen: boolean;
  renameValue: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (q: string) => void;
  onCursor: (i: number) => void;
  onPickHit: (h: FpHit) => void;
  onCloseSearch: () => void;
  onCloseFix: () => void;
  onFixAction: (action: string) => void;
  onRenameValue: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onToggleHelp: () => void;
}

export function FpOverlays(p: FpOverlaysProps) {
  return (
    <>
      <SearchPop
        open={p.searchOpen}
        query={p.query}
        hits={p.hits}
        cursor={p.cursor}
        onQuery={p.onQuery}
        onCursor={p.onCursor}
        onPick={p.onPickHit}
        onClose={p.onCloseSearch}
        inputRef={p.searchInputRef}
      />
      {p.helpOpen && (
        <div className="absolute top-12 right-3 z-40 w-[300px] rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] p-1.5 shadow-lg">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-bold text-[var(--tmd-fg-muted)]">{t("快捷键")}</div>
          {HELP_ROWS.map(([key, keys]) => (
            <div key={key} className="flex items-center justify-between px-2.5 py-1 text-[12px] text-[var(--tmd-fg)]">
              <span>{t(key)}</span>
              <kbd className="rounded border border-[var(--tmd-border,var(--tmd-border))] border-b-2 bg-[var(--tmd-bg-hover)] px-1.5 py-px font-mono text-[11px] text-[var(--tmd-fg-muted)]">{keys}</kbd>
            </div>
          ))}
        </div>
      )}
      {p.fixCard && !p.renameOpen && p.fixPos && (
        <div
          className="absolute z-40 min-w-40 rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] p-1 shadow-lg"
          style={{
            left: Math.max(8, p.fixPos.left - 120),
            /* 4 项菜单 ≈130px;贴视口底时上翻到按钮上方(评审 P1-5) */
            top: p.fixPos.top + 4 + 138 > window.innerHeight ? Math.max(8, p.fixPos.top - 142) : p.fixPos.top + 4,
          }}
        >
          {FIX_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--tmd-bg-hover)] ${a === "标记为无关" ? "text-red-500" : ""}`}
              onClick={() => p.onFixAction(a)}
            >
              {t(a)}
            </button>
          ))}
        </div>
      )}
      {p.renameOpen && (
        <div className="absolute bottom-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] p-1.5 shadow-lg">
          <input
            autoFocus
            aria-label={t("新的功能卡名称")}
            value={p.renameValue}
            onChange={(e) => p.onRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onRenameSubmit();
              if (e.key === "Escape") {
                /* 只取消重命名,不冒泡关抽屉(评审 P1-6) */
                e.stopPropagation();
                p.onRenameCancel();
              }
            }}
            className="w-[220px] rounded-lg border border-[var(--tmd-border,var(--tmd-border))] bg-transparent px-2.5 py-1 text-[12.5px] outline-none focus:border-[var(--tmd-accent,var(--tmd-accent))]"
          />
          <button
            type="button"
            className="rounded-lg bg-[var(--tmd-accent,var(--tmd-accent))] px-2.5 py-1 text-[12px] text-white"
            onClick={p.onRenameSubmit}
          >
            {t("确定")}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[12px] text-[var(--tmd-fg)]"
            onClick={p.onRenameCancel}
          >
            {t("取消")}
          </button>
        </div>
      )}
      {p.toast && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#26292e] px-4 py-1.5 text-[12px] text-white shadow-lg">
          {p.toast}
        </div>
      )}
    </>
  );
}
