/**
 * 统一搜索折叠入口 —— 左栏顶部单行条目,点开列出全部搜索能力
 * (全文搜索 ⇧⌘F / 文件名快开 ⌘P / 会话历史 ⌘O)。
 * 命令经 kernel 注册表分发(getCommands 按 id 取 run),不 import 各插件;
 * 标题与键位标签取自注册表实况(改键后自动跟随,i18n 复用命令标题零新键)。
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { formatKeybinding, getCommands } from "@kernel/shortcuts";
import { t } from "@kernel/i18n";

const MENU_ITEMS = [
  { id: "search.panel", fallback: "全文搜索" },
  { id: "search.quickOpen", fallback: "文件名快开" },
  { id: "session-search.open", fallback: "搜索会话历史…" },
];

export function SearchHubEntry() {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const run = (id: string): void => {
    setMenuOpen(false);
    getCommands().find((c) => c.id === id)?.run();
  };

  return (
    <div ref={rootRef} className="relative shrink-0 px-2 pb-1 text-[0.75rem]">
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1.5 rounded px-1 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MagnifyingGlass size="0.75rem" weight="bold" aria-hidden />
        <span className="flex-1 truncate text-left">{t("搜索")}</span>
        {menuOpen ? (
          <CaretDown size="0.625rem" aria-hidden />
        ) : (
          <CaretRight size="0.625rem" aria-hidden />
        )}
      </button>
      {menuOpen && (
        <div className="absolute top-full left-2 z-[300] mt-0.5 min-w-44 rounded-md border border-(--tmd-border) bg-(--tmd-bg-panel) py-1 shadow-lg">
          {MENU_ITEMS.map((item) => {
            const cmd = getCommands().find((c) => c.id === item.id);
            return (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[0.75rem] text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
                onClick={() => run(item.id)}
              >
                <span className="flex-1 truncate">{cmd?.title ?? t(item.fallback)}</span>
                {cmd?.keybinding && (
                  <span className="shrink-0 text-[0.6875rem] text-(--tmd-fg-faint)">
                    {formatKeybinding(cmd.keybinding)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
