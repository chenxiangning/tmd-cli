/**
 * Composer textarea 键盘分发(纯函数,无自身状态)—— 自 Composer.tsx 拆出
 * (300 行铁则 + 控复杂度)。判定顺序契约见 openspec design §6:
 * IME → 下拉 → ghost Tab → 历史 → 非空/移交。
 */

import { host } from "@kernel/host";
import { getTerminalHandle } from "@kernel/messageAnchors";
import type { SendShortcut } from "@kernel/settings";
import type { SuggestionMatch } from "../triggers/suggest";
import { shouldSendOnEnter } from "./enterAction";
import { resolveArrowIntent } from "./arrowIntent";
import type { HistoryKeyEvent } from "./usePromptHistory";

export interface ComposerKeyContext {
  matches: SuggestionMatch[] | null;
  pickIndex: number;
  setPickIndex: React.Dispatch<React.SetStateAction<number>>;
  applyPick: (m: SuggestionMatch) => void;
  dismiss: () => void;
  completion: { suffix: string; accept: () => string | null };
  cursor: number;
  value: string;
  handleHistoryNav: (ev: HistoryKeyEvent) => boolean;
  sendShortcut: SendShortcut;
  sendCurrent: () => void;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
}

export function composerTextareaKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  ctx: ComposerKeyContext,
) {
  const { matches, pickIndex, setPickIndex, applyPick, dismiss, completion } = ctx;
  const composing = e.nativeEvent.isComposing;
  if (e.key === "ArrowDown" && matches && !composing) {
    e.preventDefault();
    setPickIndex((i: number) => (matches.length ? (i + 1) % matches.length : 0));
    return;
  }
  if (e.key === "ArrowUp" && matches && !composing) {
    e.preventDefault();
    setPickIndex((i: number) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
    return;
  }
  if (matches && !composing) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (matches[pickIndex]) applyPick(matches[pickIndex]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
      return;
    }
  }
  /* ghost 补全:无下拉时 Tab 才轮到;光标在末尾才有 ghost */
  if (e.key === "Tab" && completion.suffix && !composing && ctx.cursor === ctx.value.length) {
    e.preventDefault();
    const full = completion.accept();
    if (full !== null) { ctx.setValue(full); ctx.setCursor(full.length); }
    return;
  }
  /* 输入历史召回:开启且有历史时空输入 ↑ 起翻;消费不了才落回移交 */
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !matches && ctx.handleHistoryNav(e.nativeEvent)) return;
  /* 空输入 ↑↓ → 焦点移交幕布(方向键语义归 CLI);契约:openspec design §6 */
  if (
    (e.key === "ArrowUp" || e.key === "ArrowDown") &&
    resolveArrowIntent({
      key: e.key,
      value: ctx.value,
      hasMatches: !!matches,
      isComposing: e.nativeEvent.isComposing,
    }) === "handoff"
  ) {
    e.preventDefault();
    const sid = host.getActiveSessionId();
    if (sid) getTerminalHandle(sid)?.focus();
    return;
  }
  if (e.key === "Enter" &&
    shouldSendOnEnter(
      {
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        isComposing: e.nativeEvent.isComposing,
      },
      ctx.sendShortcut,
    )) {
    e.preventDefault();
    ctx.sendCurrent();
  }
}
