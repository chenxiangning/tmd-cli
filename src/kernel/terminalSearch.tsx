/**
 * 终端搜索浮层 —— 自 TerminalView.tsx 拆出(文件规模铁则收紧至 300 行)。
 * 承担:⌘F 搜索 UI(上一个/下一个/关闭 + Aa/.\* 选项 + n/m 命中计数);
 * 纯 xterm SearchAddon 点缀,不触碰字节流。计数口径见 terminalMatchCount.ts。
 * terminal.find 命令桥与模块级 findRequestRef 在 terminalFindBridge.ts。
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { CaretDown, CaretUp, Cross } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { countTerminalMatches } from "@kernel/terminalMatchCount";
import { findRequestRef } from "@kernel/terminalFindBridge";

/* Aa/.* 选项钮的选中/未选中视觉(与检索 chip 同语系)。 */
function toggleCls(on: boolean): string {
  return `rounded px-1 text-xs leading-4 ${
    on
      ? "bg-(--tmd-accent)/15 text-(--tmd-accent)"
      : "text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
  }`;
}

export function TerminalSearchOverlay({
  searchRef,
  termRef,
  onClose,
}: {
  searchRef: RefObject<SearchAddon | null>;
  termRef: RefObject<Terminal | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [count, setCount] = useState({ total: 0, current: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  /* 命中高亮:滚动条概览标尺(中性灰 = 命中,主题色 = 活动命中)——
   * 主题色取 CSS 变量,取不到回落固定蓝;关闭时清干净。 */
  const decorations = () => ({
    matchOverviewRuler: "#8a8a8a",
    activeMatchColorOverviewRuler:
      getComputedStyle(document.documentElement).getPropertyValue("--tmd-accent").trim() || "#4a9eff",
  });
  const searchOpts = () => ({
    caseSensitive,
    regex: useRegex,
    decorations: decorations(),
  });
  /* n/m 计数:选区起点反推当前序号(addon 无序号 API,口径见 terminalMatchCount)。
   * 非法正则由 compile 返回 0 命中,find 调用方同步跳过,两边口径一致。 */
  const refreshCount = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    const sel = term.getSelectionPosition();
    setCount(
      countTerminalMatches(
        lines,
        inputRef.current?.value ?? "",
        { caseSensitive, regex: useRegex },
        sel ? { row: sel.start.y, col: sel.start.x } : null,
      ),
    );
  }, [termRef, caseSensitive, useRegex]);
  const close = () => {
    searchRef.current?.clearDecorations();
    onClose();
  };
  /* 找一次(方向 next/prev)+ 计数;空查询/非法正则不动作(与计数口径一致)。 */
  const regexOk = (q: string) => {
    if (!useRegex) return true;
    try {
      new RegExp(q);
      return true;
    } catch {
      return false;
    }
  };
  const find = (dir: "next" | "prev") => {
    const q = inputRef.current?.value ?? "";
    if (!q || !regexOk(q)) return;
    if (dir === "next") searchRef.current?.findNext(q, searchOpts());
    else searchRef.current?.findPrevious(q, searchOpts());
    refreshCount();
  };
  /* 选项翻转:重跑当前查询(新口径)再计数——浮层内即时生效,不留旧高亮。 */
  const flip = (setter: (v: boolean) => void, value: boolean) => setter(!value);
  useEffect(() => {
    if (query) find("next");
    else setCount({ total: 0, current: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 选项翻转的重跑入口,query 逐键路径在 onChange
  }, [caseSensitive, useRegex]);

  return (
    <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-2 py-1 shadow-(--tmd-shadow-popover)">
      <input
        ref={inputRef}
        value={query}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          setQuery(e.target.value);
          /* IME 组合态跳过逐字搜索(拼音中途剧烈跳选),组合结束再找;
           * DOM 值先于 onChange 落定,find 读 inputRef 即新值。 */
          if (e.target.value && !(e.nativeEvent as InputEvent).isComposing) find("next");
          else if (!e.target.value) setCount({ total: 0, current: 0 });
        }}
        onKeyDown={(e) => {
          /* IME 组合态:Enter 是确认键、Esc 取消组合,都不该当搜索快捷键 */
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            find(e.shiftKey ? "prev" : "next");
          } else if (e.key === "Escape") {
            close();
          }
        }}
        placeholder={t("搜索终端输出")}
        className="w-44 bg-transparent text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
      />
      <button
        type="button"
        title={t("区分大小写 (Aa)")}
        aria-label={t("区分大小写 (Aa)")}
        aria-pressed={caseSensitive}
        onClick={() => flip(setCaseSensitive, caseSensitive)}
        className={toggleCls(caseSensitive)}
      >
        Aa
      </button>
      <button
        type="button"
        title={t("正则表达式 (.*)")}
        aria-label={t("正则表达式 (.*)")}
        aria-pressed={useRegex}
        onClick={() => flip(setUseRegex, useRegex)}
        className={toggleCls(useRegex)}
      >
        .*
      </button>
      {query && (
        <span className="shrink-0 text-xs tabular-nums text-(--tmd-fg-muted)" aria-live="polite">
          {count.total > 0 ? t("{n}/{m}", { n: count.current, m: count.total }) : t("0/0")}
        </span>
      )}
      <button
        type="button"
        title={t("上一个 (Shift+Enter)")}
        aria-label={t("上一个 (Shift+Enter)")}
        onClick={() => find("prev")}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <CaretUp size="0.875rem" aria-hidden />
      </button>
      <button
        type="button"
        title={t("下一个 (Enter)")}
        aria-label={t("下一个 (Enter)")}
        onClick={() => find("next")}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <CaretDown size="0.875rem" aria-hidden />
      </button>
      <button
        type="button"
        title={t("关闭 (Esc)")}
        aria-label={t("关闭 (Esc)")}
        onClick={close}
        className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <Cross size="0.875rem" aria-hidden />
      </button>
    </div>
  );
}

/** ⌘F 搜索框所有权:keep-alive 后多幕布并存,模块级 findRequestRef 单槽,必须跟随
 *  激活实例 —— 激活即持有,失活/卸载仅在仍归自己时让出。返回关闭回调(关框还焦点)。 */
export function useSearchBoxOwnership(
  active: boolean,
  setOpen: (open: boolean) => void,
  termRef: RefObject<Terminal | null>,
): { close: () => void } {
  useEffect(() => {
    if (!active) return;
    const mine = () => setOpen(true);
    findRequestRef.current = mine;
    return () => {
      if (findRequestRef.current === mine) findRequestRef.current = null;
    };
  }, [active, setOpen]);
  return {
    close: () => {
      setOpen(false);
      termRef.current?.focus();
    },
  };
}
