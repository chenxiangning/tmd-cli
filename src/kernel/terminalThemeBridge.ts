/**
 * 终端主题桥 —— 活幕布 xterm 配色重刷的通知面。
 *
 * xterm theme 是 :root 终端 token 的挂载期快照,除 themeApplied 外还可能被
 * 其他写手内联改值(如壁纸插件的打穿引擎调薄 --tmd-terminal-bg);写手在
 * 此发一声,TerminalView 重读计算样式。kernel 不知道写方是谁。
 */

const listeners = new Set<() => void>();

/** 订阅终端 token 变更通知。返回退订函数。 */
export function subscribeTerminalTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 内联改写过 :root 终端 token 的写手调用(幂等,无订阅者时零开销)。 */
export function notifyTerminalThemeChanged(): void {
  listeners.forEach((fn) => fn());
}
