/**
 * 浮层视口夹取 —— 菜单/弹层以「点击点为左上」定位时,按估算尺寸夹回视口内
 * (codemoss 同款;workspace / welcome / files / git 四站共用,2026-09-30 收口)。
 * 边距 12 固定;下限 min 在外侧(max-outer),极窄/极矮窗口不出负坐标
 * (workspace 2026-09-13 全局审查定的纪律,收口时惠及其余三站)。
 */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  min = 8,
): { x: number; y: number } {
  return {
    x: Math.max(min, Math.min(x, window.innerWidth - width - 12)),
    y: Math.max(min, Math.min(y, window.innerHeight - height - 12)),
  };
}
