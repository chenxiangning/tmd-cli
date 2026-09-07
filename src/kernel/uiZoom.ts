/**
 * 界面缩放引擎 —— settings.uiZoom → webview 整页缩放(VS Code zoomLevel 同思路)。
 *
 * Tauri 环境走 ipc.setWebviewZoom(原生 pageZoom/zoomFactor:canvas 按 CSS px 重排,
 * 终端 WebGL 层保持清晰);浏览器 dev/桩环境 reject 时回落 #root CSS zoom
 * (合成层放大,非整数倍 canvas 略糊 —— 仅 dev 目检用,真窗走原生路径)。
 * main.tsx 调 bootUiZoom(),幂等。
 */

import { getSettingsState, subscribeSettings } from "./settings";
import { setWebviewZoom } from "./ipc";

function applyUiZoom(factor: number): void {
  setWebviewZoom(factor).catch(() => {
    const root = document.getElementById("root");
    if (root) root.style.zoom = String(factor);
  });
}

let booted = false;

/** 启动时调用一次:应用当前缩放并跟随设置变化。 */
export function bootUiZoom(): void {
  if (booted) return;
  booted = true;
  applyUiZoom(getSettingsState().settings.uiZoom);
  subscribeSettings(() => applyUiZoom(getSettingsState().settings.uiZoom));
}
