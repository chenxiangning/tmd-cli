/**
 * tab 右键菜单的布局估算(纯逻辑,无 JSX;不与组件同文件防 react-doctor 混出)。
 * 分组判定:任一会话能力在即分组;文件 tab 仅关闭族,保持平铺。
 * 高度按实显行数估算(行 30 + 分隔线 14)——只用于视口夹取,真值由内容撑开。
 */
export function menuLayout(p: {
  onRename?: () => void;
  onTogglePin?: () => void;
  onView?: () => void;
  onRelay?: () => void;
  onLocate?: () => void;
  muteKey?: string;
  onToggleTile?: () => void;
}): { grouped: boolean; height: number } {
  const grouped = Boolean(
    p.onRename || p.onTogglePin || p.onView || p.onRelay || p.onLocate || p.muteKey !== undefined || p.onToggleTile,
  );
  const rows =
    [p.onRename, p.onTogglePin].filter(Boolean).length +
    (p.muteKey !== undefined ? 1 : 0) +
    (p.onView || p.onRelay || p.onLocate ? 1 : 0) +
    (grouped ? 2 : 3);
  return { grouped, height: rows * 30 + 14 };
}
