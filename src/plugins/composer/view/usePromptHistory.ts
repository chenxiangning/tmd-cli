/**
 * Composer 输入历史 hooks —— 自 codemoss use-prompt-history.ts 等价移植,按
 * tmd-cli 受控 textarea 改写(setText 走 setValue + 光标复位末尾)。
 *
 * - usePromptCompletion:防抖 prefix 匹配出 ghost 后缀;IME 组合期调用方传 ""
 *   即不显示;accept() 返回完整文本(Tab 接受)。
 * - usePromptHistoryNav:shell 风格 ↑↓ 召回 —— 空输入 ↑ 起翻(最新→最旧),
 *   ↓ 回走、越过最新恢复草稿并退出;任意其他键退出导航且不消费。返回 true
 *   表示按键已被消费,Composer 在「下拉之后、幕布移交之前」调用,消费不了才
 *   落回 resolveArrowIntent(故 arrowIntent 契约零改动)。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  findPromptCompletion,
  getPromptHistory,
  subscribePromptHistory,
} from "@kernel/promptHistory";

const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

export function usePromptCompletion(text: string, enabled: boolean): {
  suffix: string;
  accept: () => string | null;
} {
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => {
    const clean = text.replace(INVISIBLE_CHARS_RE, "").trim();
    if (!enabled || clean.length < 2) {
      setSuggestion(null);
      return;
    }
    const timer = setTimeout(() => setSuggestion(findPromptCompletion(text)), 100);
    return () => clearTimeout(timer);
  }, [text, enabled]);

  const clean = text.replace(INVISIBLE_CHARS_RE, "").trim();
  const suffix =
    suggestion !== null && suggestion.length > clean.length ? suggestion.slice(clean.length) : "";

  const accept = useCallback((): string | null => {
    setSuggestion(null);
    return suggestion;
  }, [suggestion]);

  return { suffix, accept };
}

/** 召回落文本:value 写回 + 光标/焦点复位末尾。 */
function recall(
  ta: HTMLTextAreaElement,
  setValue: (text: string) => void,
  setCursor: (i: number) => void,
  text: string,
): void {
  setValue(text);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    setCursor(text.length);
  });
}

/** 召回导航消费的按键面(React 键盘子集,nav 判定只看这些)。 */
export interface HistoryKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function usePromptHistoryNav({ textareaRef, value, setValue, setCursor, enabled }: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (text: string) => void;
  setCursor: (i: number) => void;
  enabled: boolean;
}): { handleKeyDown: (e: HistoryKeyEvent) => boolean } {
  const indexRef = useRef(-1);
  const draftRef = useRef("");

  /* 提交即入史并清空输入:丢弃召回游标(下次 ↑ 从最新重新起翻)。 */
  useEffect(
    () =>
      subscribePromptHistory(() => {
        indexRef.current = -1;
        draftRef.current = "";
      }),
    [],
  );

  const handleKeyDown = useCallback(
    (e: HistoryKeyEvent): boolean => {
      const isNavigating = indexRef.current !== -1;
      if (!enabled) return false;
      /* 导航中按其他键:退出导航,不消费(该键照常走发送/输入路径)。 */
      if (isNavigating && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
        indexRef.current = -1;
        draftRef.current = "";
        return false;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false;

      const items = getPromptHistory();
      if (items.length === 0) return false;

      const ta = textareaRef.current;
      /* 仅空输入可起翻;↓ 永不起翻(起翻后 ↓ 是回走)。 */
      if (!isNavigating) {
        if (e.key === "ArrowDown") return false;
        if (value.replace(INVISIBLE_CHARS_RE, "").trim()) return false;
      }
      if (!ta) return false;

      e.preventDefault();
      e.stopPropagation();
      if (!isNavigating) draftRef.current = value;

      if (e.key === "ArrowUp") {
        const next = isNavigating ? Math.max(0, indexRef.current - 1) : items.length - 1;
        indexRef.current = next;
        recall(ta, setValue, setCursor, items[next] ?? draftRef.current);
        return true;
      }
      if (indexRef.current < items.length - 1) {
        indexRef.current += 1;
        recall(ta, setValue, setCursor, items[indexRef.current] ?? draftRef.current);
        return true;
      }
      /* ↓ 越过最新:恢复起翻前草稿(空输入起翻即清空),退出导航。 */
      indexRef.current = -1;
      recall(ta, setValue, setCursor, draftRef.current);
      draftRef.current = "";
      return true;
    },
    [enabled, textareaRef, value, setValue, setCursor],
  );

  return { handleKeyDown };
}
