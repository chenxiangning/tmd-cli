/**
 * 全局文件拖放护栏 —— 阻止 webview「drop 即导航打开文件」。
 *
 * 背景:src-tauri/src/lib.rs 用 disable_drag_drop_handler() 关掉了 Tauri 原生
 * drop 拦截,换取 HTML5 drop 事件直达 composer;代价是 WKWebView 默认行为回归 ——
 * 文件拖到 composer 之外(幕布/侧栏/面板)时,webview 直接导航到 file://,
 * 整个 UI 被替换,表现为「客户端打开文件且无法退出」。
 *
 * 解法:window 捕获阶段对携带文件的拖拽(dragenter/dragover/drop)preventDefault。
 * 只取消默认导航,不拦截传播 —— composer 的 React onDrop 照常收事件并处理附件;
 * 不含 Files 的拖拽(纯文本、附件重排)不碰,保留 textarea 原生 drop 行为。
 *
 * target 参数仅测试注入用,生产走默认 window。
 */

export function bootDropGuard(target: EventTarget = window): () => void {
  const guard = (e: Event): void => {
    const dt = (e as DragEvent).dataTransfer;
    if (!dt || !Array.from(dt.types).includes("Files")) return;
    e.preventDefault();
  };
  /* capture 用对象形式:true 布尔形式在 node EventTarget 里 add/remove 不对称(卸不掉) */
  target.addEventListener("dragenter", guard, { capture: true });
  target.addEventListener("dragover", guard, { capture: true });
  target.addEventListener("drop", guard, { capture: true });
  return () => {
    target.removeEventListener("dragenter", guard, { capture: true });
    target.removeEventListener("dragover", guard, { capture: true });
    target.removeEventListener("drop", guard, { capture: true });
  };
}
