/**
 * mobile composer Enter 行为判定 —— 纯函数,与 DOM/React 解耦(vitest 直测)。
 *
 * 移动端平台惯例:裸 Enter = 换行(软键盘无 Shift,换行只能走默认行为),
 * 发送归 ↑ 钮;硬件键盘 ⌘/Ctrl+Enter 兜底发送。
 *
 * IME 组合期守卫与桌面契约同款(plugins/composer/view/enterAction.ts;mobile
 * 按架构铁则不 import 插件 view 模块,判定内联,此注指路防漂移):
 * isComposing 与 keyCode 229(WKWebView 组合末尾确认 Enter 的通用标记)一律
 * 不拦截 —— 拼音选词回车曾经把半截草稿直接发出。
 */
export interface MobileEnterMods {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  /** 229 = IME 在途(部分 WebView 组合末尾仍派发,通用兜底标记)。 */
  keyCode?: number;
}

/** "send" = 拦截默认并发送;"newline" = 走 textarea 默认(换行/输入法确认)。 */
export function mobileEnterAction(mods: MobileEnterMods): "send" | "newline" {
  if (mods.isComposing || mods.keyCode === 229) return "newline";
  if (mods.metaKey || mods.ctrlKey) return "send";
  return "newline";
}
