/**
 * 管理模式拖选范围扩散 —— 自 SessionManage.tsx 拆出(only-export-components:
 * 组件文件只导出组件;纯函数归独立模块,单测同源引用)。
 */

/** 拖选范围扩散:把 order[from..to] 按 val 增删,范围外保持不变。 */
export function selectRange(
  prev: Set<string>,
  order: string[],
  from: number,
  to: number,
  val: boolean,
): Set<string> {
  const next = new Set(prev);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = lo; i <= hi; i++) {
    const key = order[i];
    if (key === undefined) continue;
    if (val) next.add(key);
    else next.delete(key);
  }
  return next;
}
