/**
 * 差异面板拖选范围扩散 —— 会话列表管理模式(selectRange)同款交互的纯函数拆件:
 * 行序 order 上按 [min(from,to), max(from,to)] 取键集,由调用方按 val 整批增删。
 * 键 = 文件路径;order 只含可勾选行(未暂存非冲突 + 未跟踪,不含待提交段)。
 */

/** 范围取键:order[from..to](含两端,方向无关),越界自动截断。 */
export function sweepKeys(order: string[], from: number, to: number): string[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(order.length - 1, Math.max(from, to));
  return lo > hi ? [] : order.slice(lo, hi + 1);
}
