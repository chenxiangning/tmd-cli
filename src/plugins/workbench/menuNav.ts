/**
 * role=menu 面板的键盘导航下标计算(纯函数)。
 * 自 OverlayActions 抽出:组件文件只导出组件(react-doctor only-export-components),
 * 而导航下标数学是纯的、可测的,单独成模块。
 *
 * 契约:
 * - ArrowDown / ArrowUp 环绕(count 内循环),焦点尚未落进菜单(current < 0)时
 *   分别落到首项 / 末项;
 * - Home / End 跳首 / 末;
 * - 其余键返回 null = 不归菜单处理,调用方放行(Enter/Space 由 button 原生激活,
 *   Escape 由外层关闭逻辑负责);
 * - 空菜单恒 null。
 */
export function menuNavIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
