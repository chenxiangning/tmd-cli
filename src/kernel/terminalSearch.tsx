/**
 * 终端搜索浮层与 terminal.find 命令桥 —— 自 TerminalView.tsx 拆出(文件规模铁则收紧至 300 行)。
 * 承担:⌘F 搜索 UI(上一个/下一个/关闭)与 terminal 作用域命令登记;
 * 纯 xterm SearchAddon 点缀,不触碰字节流。
 */

import { useState, type RefObject } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { CaretDown, CaretUp, Cross } from "@phosphor-icons/react";
import { registerCommand } from "@kernel/shortcuts";

/* ── 终端作用域命令桥(spec 2026-09-05-shortcuts) ──
 * 终端内自由快捷键一律不变:键照旧进 PTY,只有 terminal 作用域命令经
 * attachCustomKeyEventHandler 桥触发。一期唯一成员 terminal.find(⌘F,行为
 * 与桥接入前完全一致);搜索 UI 归内核终端本体,故命令在此登记,组件实例
 * 经 findRequestRef 接收触发。 */
export const findRequestRef: { current: (() => void) | null } = { current: null };
registerCommand({
  id: "terminal.find",
  title: "终端搜索",
  keybinding: "Cmd+F",
  scope: "terminal",
  run: () => findRequestRef.current?.(),
});

export function TerminalSearchOverlay({
  searchRef,
  onClose,
}: {
  searchRef: RefObject<SearchAddon | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  return (
    <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-2 py-1 shadow-lg">
      <input
        autoFocus
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
        placeholder="搜索终端输出"
        className="w-44 bg-transparent text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
      />
      <button
        title="上一个 (Shift+Enter)"
        onClick={() => query && searchRef.current?.findPrevious(query)}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <CaretUp size={14} />
      </button>
      <button
        title="下一个 (Enter)"
        onClick={() => query && searchRef.current?.findNext(query)}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <CaretDown size={14} />
      </button>
      <button
        title="关闭 (Esc)"
        onClick={onClose}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <Cross size={14} />
      </button>
    </div>
  );
}
