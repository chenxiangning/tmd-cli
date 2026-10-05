/* 窗口圆角态内核(2026-10-04):macOS 窗口最大化/全屏时系统圆角消失,贴角顺弧
 * UI(左下设置 logo 的 border-bottom-left-radius)需回落直角,否则弧外露缝。
 * bootWindowCorners() 幂等:启动初查 + onWindowGeometryChange 重判,
 * 置位 html[data-window-square] 供 CSS 消费。web 态 ipc 恒 false,标记永不置。
 * DesktopApp useEffect 调 bootWindowCorners(),与 bootUiZoom 同纪律。 */

import { onWindowGeometryChange, windowSquareCorners } from "./ipc";

let booted = false;

function applyWindowSquare(square: boolean): void {
  document.documentElement.toggleAttribute("data-window-square", square);
}

/** 启动时调用一次:初查圆角态并跟随窗口几何变化重判。 */
export function bootWindowCorners(): void {
  if (booted) return;
  booted = true;
  const refresh = () => {
    void windowSquareCorners()
      .then(applyWindowSquare)
      .catch(() => undefined); /* 判定失败静默:保持现状,不闪动 */
  };
  refresh();
  onWindowGeometryChange(refresh);
}
