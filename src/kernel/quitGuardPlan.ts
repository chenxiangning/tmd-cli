/**
 * 退出裁决(纯函数,单测面)—— 自 quitGuard.tsx 迁出(组件文件只留组件,
 * Fast Refresh 才能安全保态):
 * - ask = 有脏稿且未勾「不再问」:拦下,弹聚合确认;
 * - noop = 无须拦(脏空/已勾),不调 prevent,原生关闭自走
 *   (防脏空场景 windowClose 补发造成的重入死循环)。
 */
export function planQuit(dirtyCount: number, skipAsk: boolean): "noop" | "ask" {
  if (dirtyCount > 0 && !skipAsk) return "ask";
  return "noop";
}
