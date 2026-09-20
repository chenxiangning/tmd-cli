/**
 * Composer Enter 键行为判定 —— 纯函数,与 DOM/React 解耦(vitest 可直接守护)。
 *
 * 契约:
 * - IME 组合中(isComposing)一律不拦截,交给输入法确认候选。
 * - "enter" 模式:裸 Enter 发送,Shift+Enter 换行(默认行为,不拦截)。
 * - "cmdOrCtrlEnter" 模式:⌘/Ctrl+Enter 发送,裸 Enter 换行(默认行为,不拦截)。
 *
 * 建议下拉打开时的 Enter(选中候选)在组件层优先短路,不经过本函数。
 */

import type { SendShortcut } from "@kernel/settings";

export interface EnterKeyMods {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  /** 229 = IME 在途(部分 WebView 组合末尾仍派发,通用兜底标记)。 */
  keyCode?: number;
}

/** 返回 true = 拦截默认行为并发送;false = 走 textarea 默认(换行/输入法确认)。 */
export function shouldSendOnEnter(
  mods: EnterKeyMods,
  sendShortcut: SendShortcut,
): boolean {
  /* keyCode 229 兜底:部分 WKWebView 在 compositionend 之后派发确认 Enter 且
   * isComposing=false(Chromium 正常)——229 是 IME 处理中事件的通用标记。 */
  if (mods.isComposing || mods.keyCode === 229) return false;
  if (sendShortcut === "cmdOrCtrlEnter") {
    return mods.metaKey || mods.ctrlKey;
  }
  return !mods.shiftKey;
}
