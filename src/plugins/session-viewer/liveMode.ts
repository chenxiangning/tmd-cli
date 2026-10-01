/**
 * 活会话转录视图模式 store 与尾窗切片纯函数 —— 每会话「幕布 | 转录」显示态
 * (会话级记忆:切走再切回保留各自形态;默认幕布)。模块级 subscribable store
 * (approval-inbox 先例):浮层组件订阅重渲染,退出剪除挂 index.tsx activate。
 * 设计:docs/superpowers/specs/2026-09-30-live-transcript-view-design.md
 */
import type { CliTranscriptBlock } from "@kernel/cli";
type Listener = () => void;

const modes = new Map<string, boolean>();
const listeners = new Set<Listener>();

export function isLiveTranscript(sessionId: string): boolean {
  return modes.get(sessionId) === true;
}

export function setLiveTranscript(sessionId: string, on: boolean): void {
  if (on) modes.set(sessionId, true);
  else modes.delete(sessionId);
  for (const l of listeners) l();
}

/** 会话退出剪除(防单调增长;boardRows LIVE_FIRST_SEEN 同款纪律)。 */
export function pruneLiveTranscript(sessionId: string): void {
  if (modes.delete(sessionId)) for (const l of listeners) l();
}

export function subscribeLiveMode(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 尾窗切片(live 只看尾部,向上回溯;纯函数可测)。 */
export function tailWindow(blocks: CliTranscriptBlock[], visible: number): CliTranscriptBlock[] {
  return blocks.length <= visible ? blocks : blocks.slice(blocks.length - visible);
}

export type ProbeDecision = "relocate" | "terminal" | "read" | "idle";

/** 浮标能力门(纯函数,单测钉死):kimi/grok 的磁盘会话是目录、opencode/dsh
 * 是合成串,fsReadTailChanged 永远探错 —— decideProbe 熔断名单的前置化,
 * 这些引擎直接不出「结构化视图」钮,不再点开才报不支持;qoder 系为真文件不拦。 */
export function pillCapable(
  profileId: string | undefined,
  hasReader: boolean,
): boolean {
  if (!hasReader || !profileId) return false;
  const p = profileId.toLowerCase();
  return !(p.startsWith("kimi") || p.startsWith("grok") || p.startsWith("opencode") || p.startsWith("dsh"));
}

/** 轮询决策(纯函数,单测钉死熔断语义):
 * - 探测失败:第一次回 relocate 容瞬态;重定位命中后再探错 = 路径非可读文件
 *   (kimi/grok 会话目录、opencode/dsh 合成串),回 terminal 熔断;
 * - 探测成功:有变更回 read,无变更回 idle 继续等待。
 * (未定位磁盘会话由调用方早退重试,不经本函数。) */
export function decideProbe(
  probe: { changed: boolean } | null,
  failStreak: number,
): { decision: ProbeDecision; failStreak: number } {
  if (!probe) {
    return failStreak > 0
      ? { decision: "terminal", failStreak: 0 }
      : { decision: "relocate", failStreak: 1 };
  }
  return probe.changed
    ? { decision: "read", failStreak: 0 }
    : { decision: "idle", failStreak: 0 };
}

/** 块引用复用:字段全等的块沿用旧引用 —— react-markdown 零内部缓存,
 * 引用刷新 = 全量重跑 remark/rehype;转录 append-only,下标错位时 id 不等自然回落新引用。
 * 自 liveOverlay.tsx 迁入(纯函数归 ts 模块;300 行铁则)。 */
export function stableBlocks(prev: CliTranscriptBlock[] | null, next: CliTranscriptBlock[]): CliTranscriptBlock[] {
  if (!prev) return next;
  return next.map((b, i) => {
    const p = prev[i];
    return p && p.id === b.id && p.role === b.role && p.text === b.text
      && p.startedAt === b.startedAt && p.images === b.images && p.tool === b.tool
      ? p
      : b;
  });
}
