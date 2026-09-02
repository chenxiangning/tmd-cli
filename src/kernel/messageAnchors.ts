/**
 * 对话锚点内核 —— 用户消息锚点的数据缓存、订阅与幕布跳转中转。
 *
 * 边界:
 * - 数据:cli-* 插件经 CliProfile.readSessionUserMessages 提供(jsonl 行型是 CLI 私有知识);
 *   本模块只做轮询、按 id 增量合并、订阅通知,不理解任何行型。
 * - 跳转:TerminalView 注册 TerminalHandle(xterm 实例的窄接口),
 *   锚点栏(composer 插件)经 jumpToAnchor 中转,不直接触达 xterm。
 * - host.ts 零改动:经 host 单例的公开访问器取活跃会话/profile,单向依赖无环。
 *
 * 轮询纪律与 host 状态巡航同策略:仅活跃会话、仅在有订阅者时 2s tick,0 订阅停表。
 */

import { host } from "./host";
import type { CliUserMessage } from "./cli";
import { KernelTopics } from "./events";
import type { SessionMeta } from "./ipc";

/** 锚点 = 一条用户消息(与 CliUserMessage 同形,内核内改名强调导航语义)。 */
export type UserMessageAnchor = CliUserMessage;

/* ── 数据存储 ─────────────────────────────────────────────── */

interface AnchorCacheEntry {
  /** 稳定数组引用:useSyncExternalStore 快照直接持有了它,只在内容变化时换新数组。 */
  anchors: UserMessageAnchor[];
  seen: Set<string>;
  fullLoaded: boolean;
}

const POLL_MS = 2000;
const EMPTY: readonly UserMessageAnchor[] = [];

class MessageAnchorStore {
  private cache = new Map<string, AnchorCacheEntry>();
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private inFlight = false;

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    if (this.listeners.size === 1) this.startPolling();
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) this.stopPolling();
    };
  };

  /** 快照:无缓存返回共享 EMPTY,保证 getSnapshot 引用稳定。 */
  getAnchors(sessionId: string | null): readonly UserMessageAnchor[] {
    if (!sessionId) return EMPTY;
    return this.cache.get(sessionId)?.anchors ?? EMPTY;
  }

  remove(sessionId: string): void {
    this.cache.delete(sessionId);
  }
  /** 当前有缓存的会话 id 集(sessionsChanged 时修剪残留用)。 */
  cachedSessionIds(): string[] {
    return [...this.cache.keys()];
  }

  private startPolling(): void {
    if (this.timer !== null) return;
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    /* 上一轮未完成的慢 IO(大文件全量读)不叠加 */
    if (this.inFlight) return;
    const sessionId = host.getActiveSessionId();
    if (!sessionId) return;
    const cliSessionId = host.getCliSessionId(sessionId);
    if (!cliSessionId) return;
    const session = host.getSessions().find((s) => s.id === sessionId);
    const profile = session ? host.getCliProfile(session.profileId) : undefined;
    if (!session || !profile?.readSessionUserMessages) return;

    let entry = this.cache.get(sessionId);
    const full = !entry?.fullLoaded;
    this.inFlight = true;
    let batch: CliUserMessage[] | null;
    try {
      batch = await profile.readSessionUserMessages(session.cwd, cliSessionId, full);
    } catch {
      batch = null;
    } finally {
      this.inFlight = false;
    }
    if (!batch) return;

    entry ??= { anchors: [], seen: new Set(), fullLoaded: false };
    if (full) entry.fullLoaded = true;
    const fresh = batch.filter((m) => !entry.seen.has(m.id));
    if (fresh.length === 0) {
      this.cache.set(sessionId, entry);
      return;
    }
    for (const m of fresh) entry.seen.add(m.id);
    entry.anchors = [...entry.anchors, ...fresh];
    this.cache.set(sessionId, entry);
    this.listeners.forEach((cb) => cb());
  }
}

export const messageAnchors = new MessageAnchorStore();
/* 缓存生命周期跟随会话:退出即清;列表收缩时清掉已不存在的会话残留。 */
host.events.on<string>(KernelTopics.sessionExited, (id) => messageAnchors.remove(id));
host.events.on<SessionMeta[]>(KernelTopics.sessionsChanged, (sessions) => {
  const alive = new Set(sessions.map((s) => s.id));
  for (const id of messageAnchors.cachedSessionIds()) {
    if (!alive.has(id)) messageAnchors.remove(id);
  }
});

/* ── 幕布跳转注册表 ────────────────────────────────────────── */

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

/* ── 定位与跳转(纯逻辑,fake handle 可测)──────────────────── */

/** composer 注入的附件引用 token(@path),幕布气泡里不显示原文,匹配前剥掉。 */
const ATTACH_TOKEN_RE = /@[^\s@]+/g;
/** needle 长度梯队:长 needle 防误配,逐级退化防气泡截断/重排。 */
const NEEDLE_LENGTHS = [24, 14, 8] as const;
/** 跳转留头比例(对齐 codemoss:目标滚到视口 28% 处)。 */
const JUMP_HEADROOM = 0.28;
/** active 参考线:视口顶 + min(6 行, 32%),对齐 codemoss 的 min(96px, 32%)。 */
const ACTIVE_REF_MAX_ROWS = 6;
const ACTIVE_REF_RATIO = 0.32;
/** 向上找 active 锚点的行数上限:稀疏会话防长遍历,找不到保持原 active。 */
const ACTIVE_WALK_LIMIT = 4000;
/** 跳转翻页上限:12 页 × 512KB = 6MB 历史,超出判定消息不可达。 */
const JUMP_PAGE_LIMIT = 12;

const needleCache = new WeakMap<UserMessageAnchor, string>();

/** 消息文本 → 幕布匹配 needle:剥 @token、折叠空白、取首行首 24 字符。 */
export function anchorNeedle(anchor: UserMessageAnchor): string {
  const cached = needleCache.get(anchor);
  if (cached !== undefined) return cached;
  const firstLine = anchor.text.split("\n").find((l) => l.trim()) ?? "";
  const stripped = firstLine.replace(ATTACH_TOKEN_RE, " ").replace(/\s+/g, " ").trim();
  /* 纯附件消息剥空后回退原文首行,仍有机会命中气泡里的残留文本 */
  const source = stripped || firstLine.replace(/\s+/g, " ").trim();
  const needle = source.slice(0, NEEDLE_LENGTHS[0]);
  needleCache.set(anchor, needle);
  return needle;
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 自底向上找 needle 所在行;长 needle 不命中逐级退化到 8 字符。 */
export function findAnchorRow(handle: TerminalHandle, needle: string): number | null {
  if (!needle) return null;
  for (const len of NEEDLE_LENGTHS) {
    const n = needle.slice(0, len);
    if (!n) continue;
    for (let row = handle.bufferLength() - 1; row >= 0; row--) {
      if (normalizeLine(handle.lineText(row)).includes(n)) return row;
    }
  }
  return null;
}

/** 点击跳转:buffer 定位 → 28% 留头;消息太老不在 buffer 时逐页加载更早历史再试。 */
export async function jumpToAnchor(
  sessionId: string,
  anchor: UserMessageAnchor,
): Promise<boolean> {
  const handle = terminals.get(sessionId);
  if (!handle) return false;
  const needle = anchorNeedle(anchor);
  for (let page = 0; ; page++) {
    const row = findAnchorRow(handle, needle);
    if (row !== null) {
      await smoothScrollToLine(handle, Math.max(0, row - Math.round(handle.rows() * JUMP_HEADROOM)));
      return true;
    }
    if (page >= JUMP_PAGE_LIMIT || !handle.hasMoreHistory()) return false;
    const before = handle.bufferLength();
    await handle.loadEarlier();
    /* 翻页无进展(加载中重入/日志读空)即放弃,防空转 */
    if (handle.bufferLength() === before) return false;
  }
}
/* ── 平滑滚动 ────────────────────────────────────────────── */

/** 跳转动画时长;短距离缩短,避免小幅跳转也拖满全程。 */
const SMOOTH_SCROLL_MAX_MS = 260;
/* node 测试环境无 rAF,退 16ms 定时器;行为等价。 */
const raf: (cb: (now: number) => void) => void =
  globalThis.requestAnimationFrame ??
  ((cb) => void setTimeout(() => cb(performance.now()), 16));

/**
 * ease-out 动画滚动到目标行:xterm scrollToLine 本身瞬移,
 * 逐帧插值 viewportTop → target,视觉上跟手不跳变。
 * 用户中途滚轮/新跳转进来时让位(最新一帧赢)。
 */
let smoothScrollToken = 0;

/**
 * 返回的 promise 在动画落位后 resolve:测试可确定性断言落点,
 * UI 调用方 fire-and-forget 不阻塞。
 */
function smoothScrollToLine(handle: TerminalHandle, target: number): Promise<void> {
  const token = ++smoothScrollToken;
  const start = handle.viewportTop();
  const distance = target - start;
  if (Math.abs(distance) <= 2) {
    handle.scrollToLine(target);
    return Promise.resolve();
  }
  const duration = Math.min(SMOOTH_SCROLL_MAX_MS, 80 + Math.abs(distance) * 1.2);
  const t0 = performance.now();
  const { promise, resolve } = Promise.withResolvers<void>();
  const step = (now: number) => {
    if (token !== smoothScrollToken) return resolve();
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - (1 - p) ** 3;
    handle.scrollToLine(Math.round(start + distance * eased));
    if (p < 1) raf(step);
    else resolve();
  };
  raf(step);
  return promise;
}

/**
 * 滚动 active 追踪:视口参考线向上找最近一条锚点所在行。
 * 等价 codemoss 的"参考线取最近用户消息",但数据源从 DOM rect 换成 buffer 行文本。
 */
export function resolveActiveAnchorId(
  handle: TerminalHandle,
  anchors: readonly UserMessageAnchor[],
): string | null {
  if (anchors.length === 0) return null;
  const needles = anchors.map((a) => ({ id: a.id, needle: anchorNeedle(a) }));
  const top = handle.viewportTop();
  const ref = top + Math.min(ACTIVE_REF_MAX_ROWS, Math.round(handle.rows() * ACTIVE_REF_RATIO));
  const floor = Math.max(0, ref - ACTIVE_WALK_LIMIT);
  for (let row = Math.min(ref, handle.bufferLength() - 1); row >= floor; row--) {
    const line = normalizeLine(handle.lineText(row));
    if (!line) continue;
    for (const { id, needle } of needles) {
      if (needle && line.includes(needle)) return id;
    }
  }
  return null;
}
