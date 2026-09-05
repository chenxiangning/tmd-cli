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
 *
 * 文件规模铁则拆分(300 行):handle 注册表在 terminalHandles.ts,定位/跳转逻辑在
 * anchorJump.ts;本文件留数据缓存并 re-export,保持 import 契约不变。
 */

import { host } from "./host";
import type { CliUserMessage } from "./cli";
import { KernelTopics } from "./events";
import type { SessionMeta } from "./ipc";

export {
  getTerminalHandle,
  registerTerminalHandle,
  subscribeTerminalRegistry,
  terminalRegistryVersion,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "./terminalHandles";
export {
  anchorNeedle,
  findAnchorRow,
  jumpToAnchor,
  resolveActiveAnchorId,
} from "./anchorJump";

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
