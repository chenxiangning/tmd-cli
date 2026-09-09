/**
 * 界面缩放引擎 —— settings.uiZoom → webview 整页缩放(VS Code zoomLevel 同思路)。
 *
 * Tauri 环境走 ipc.setWebviewZoom(原生 pageZoom/zoomFactor:文本按 CSS px 重排,
 * 终端 xterm DOM 文本层保持清晰);浏览器 dev/桩环境 reject 时回落 #root CSS zoom
 * (合成层放大,非整数倍文本层略糊 —— 仅 dev 目检用,真窗走原生路径)。
 * main.tsx 调 bootUiZoom(),幂等。
 */

import { getSettingsState, subscribeSettings } from "./settings";
import { setWebviewZoom } from "./ipc";

function applyUiZoom(factor: number): void {
  const fallback = () => {
    const root = document.getElementById("root");
    if (root) root.style.zoom = String(factor);
  };
  try {
    /* 桩/浏览器环境 Tauri 模块可能在调用前同步抛,Promise.reject 走 catch、同步抛走 try。 */
    setWebviewZoom(factor).catch(fallback);
  } catch {
    fallback();
  }
}

let booted = false;

/** 启动时调用一次:应用当前缩放并跟随设置变化。 */
export function bootUiZoom(): void {
  if (booted) return;
  booted = true;
  applyUiZoom(getSettingsState().settings.uiZoom);
  subscribeSettings(() => applyUiZoom(getSettingsState().settings.uiZoom));
}
