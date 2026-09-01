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
}

/** 返回 true = 拦截默认行为并发送;false = 走 textarea 默认(换行/输入法确认)。 */
export function shouldSendOnEnter(
  mods: EnterKeyMods,
  sendShortcut: SendShortcut,
): boolean {
  if (mods.isComposing) return false;
  if (sendShortcut === "cmdOrCtrlEnter") {
    return mods.metaKey || mods.ctrlKey;
  }
  return !mods.shiftKey;
}
