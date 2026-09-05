/**
 * 幕布跳转注册表 —— 自 messageAnchors.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:xterm 实例窄接口(TerminalHandle)的注册/注销/查询与版本订阅。
 * 锚点数据缓存留在 messageAnchors.ts;定位/跳转逻辑在 anchorJump.ts。
 */

/**
 * xterm 实例的窄接口 —— TerminalView 注册,锚点栏消费。
 * 全部方法同步直读 buffer;loadEarlier 是唯一异步(翻页重写)。
 */
export interface TerminalHandle {
  /** buffer 绝对行号 → 该行文本(去尾随空白);越界返回空串。 */
  lineText(row: number): string;
  /** buffer 总行数(含 scrollback)。 */
  bufferLength(): number;
  /** 当前视口顶行的 buffer 绝对行号。 */
  viewportTop(): number;
  /** 视口行数。 */
  rows(): number;
  scrollToLine(row: number): void;
  /** xterm 聚焦(composer 空输入 ↑↓ 焦点移交用;无 handle 时调用方静默)。 */
  focus(): void;
  /** 订阅滚动;返回退订函数。 */
  onScroll(cb: () => void): () => void;
  /** 会话日志还有更早未加载的输出。 */
  hasMoreHistory(): boolean;
  /** 往前翻一页历史(RIS 重写幕布);完成后 buffer 内容增加。 */
  loadEarlier(): Promise<void>;
}

const terminals = new Map<string, TerminalHandle>();
const terminalListeners = new Set<() => void>();
let registryVersion = 0;

/** 注册表版本快照:注册/注销时单调递增,供 useSyncExternalStore getSnapshot。 */
export function terminalRegistryVersion(): number {
  return registryVersion;
}

/** 注册表版本号订阅:TerminalView 按 sessionId key 重挂载,消费者借此重取 handle。 */
export function subscribeTerminalRegistry(cb: () => void): () => void {
  terminalListeners.add(cb);
  return () => terminalListeners.delete(cb);
}

export function registerTerminalHandle(sessionId: string, handle: TerminalHandle): void {
  terminals.set(sessionId, handle);
  registryVersion += 1;
  terminalListeners.forEach((cb) => cb());
}

export function unregisterTerminalHandle(sessionId: string, handle: TerminalHandle): void {
  /* 同 session 重挂载时新 handle 先注册,仅删自己,防误删继任者 */
  if (terminals.get(sessionId) !== handle) return;
  terminals.delete(sessionId);
  registryVersion += 1;
  terminalListeners.forEach((cb) => cb());
}

export function getTerminalHandle(sessionId: string): TerminalHandle | undefined {
  return terminals.get(sessionId);
}
