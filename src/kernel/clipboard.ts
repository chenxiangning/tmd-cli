/**
 * 写剪贴板唯一原语(2026-09-25 修 ⌘C 菜单「剪贴板写入失败」):macOS WKWebView
 * 对 async clipboard 有 focus/activation 苛刻校验,Tauri 窗口内常拒;故先在点击
 * 手势内同步走 textarea + execCommand(与 xterm.js 自身复制同技法),失败再退
 * async clipboard,两者皆败才抛——调用方的错误提示才真实。
 */
export async function copyText(text: string): Promise<void> {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    /* jsdom / 不支持 execCommand 的环境,落 async clipboard */
  }
  ta.remove();
  if (ok) return;
  await navigator.clipboard.writeText(text);
}
