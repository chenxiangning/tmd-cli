/**
 * 终端搜索浮层 —— 自 TerminalView.tsx 拆出(文件规模铁则收紧至 300 行)。
 * 承担:⌘F 搜索 UI(上一个/下一个/关闭);纯 xterm SearchAddon 点缀,不触碰字节流。
 * terminal.find 命令桥与模块级 findRequestRef 在 terminalFindBridge.ts。
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { CaretDown, CaretUp, Cross } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function TerminalSearchOverlay({
  searchRef,
  onClose,
}: {
  searchRef: RefObject<SearchAddon | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-2 py-1 shadow-lg">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) searchRef.current?.findNext(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (e.shiftKey) {
              if (query) searchRef.current?.findPrevious(query);
            } else if (query) {
              searchRef.current?.findNext(query);
            }
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder={t("搜索终端输出")}
        className="w-44 bg-transparent text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
      />
      <button
        title={t("上一个 (Shift+Enter)")}
        onClick={() => query && searchRef.current?.findPrevious(query)}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <CaretUp size="0.875rem" />
      </button>
      <button
        title={t("下一个 (Enter)")}
        onClick={() => query && searchRef.current?.findNext(query)}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <CaretDown size="0.875rem" />
      </button>
      <button
        title={t("关闭 (Esc)")}
        onClick={onClose}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <Cross size="0.875rem" />
      </button>
    </div>
  );
}
