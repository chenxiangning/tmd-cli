/**
 * 界面字号引擎 —— settings.uiFontSize → html 根字号(rem 体系锚点)。
 *
 * 纯文字级缩放:全库排版走 Tailwind rem 字号(text-xs = var(--text-xs) = 0.75rem 等,
 * 任意 px 字号已等值迁 rem),根字号一变所有模块文字随动;
 * 布局壳(@theme --spacing: 4px 绝对值)与 xterm 像素网格不受影响。
 * main.tsx 调 bootUiFontSize(),幂等。
 */

import { getSettingsState, subscribeSettings } from "./settings";

function applyUiFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`;
}

let booted = false;

/** 启动时调用一次:应用当前字号并跟随设置变化。 */
export function bootUiFontSize(): void {
  if (booted) return;
  booted = true;
  applyUiFontSize(getSettingsState().settings.uiFontSize);
  subscribeSettings(() => applyUiFontSize(getSettingsState().settings.uiFontSize));
}
