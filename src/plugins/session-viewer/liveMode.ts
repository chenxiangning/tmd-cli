/**
 * 活会话转录视图模式 store 与尾窗切片纯函数 —— 每会话「幕布 | 转录」显示态
 * (会话级记忆:切走再切回保留各自形态;默认幕布)。模块级 subscribable store
 * (approval-inbox 先例):浮层组件订阅重渲染,退出剪除挂 index.tsx activate。
 * 设计:docs/superpowers/specs/2026-09-30-live-transcript-view-design.md
 */
import type { CliDiskSession, CliTranscriptBlock } from "@kernel/cli";
import type { CliProfile } from "@kernel/cliProfile";
/* cli-shared 联合消费先例(AGENTS 准入:feature 插件 session-viewer 消费
 * CLI 转录格式知识;2026-10-06 活视图增量尾读)。 */
import { pairToolResults } from "../cli-shared/sessionTranscript";
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

/** 增量尾读状态(组件 ref 持有):raw = 跨拍累计的未 pair 原始块;
 *  offset = 行对齐续读偏移;truncated = 首读(全量拍)定格。 */
export interface LiveTailState {
  raw: CliTranscriptBlock[] | null;
  offset: number | null;
  truncated: boolean;
}

/** 变更拍读取:JSONL 追加式家族(readTranscriptTail 声明)增量段解析 + 跨拍
 *  累计后全量 pairToolResults(工具结果块可与上拍的调用块配对,不能只对增量
 *  段 pair);未声明家族回落 readSessionTranscript 全量重读。null = 读失败。
 *  2026-10-06:8MB+ 大转录活视图全量重读(每秒约百毫秒主线程)时代结束。 */
export async function readChangedTranscript(
  profile: Pick<CliProfile, "readSessionTranscript" | "readTranscriptTail">,
  session: CliDiskSession,
  fileSize: number,
  tail: LiveTailState,
): Promise<{ blocks: CliTranscriptBlock[]; truncated: boolean } | null> {
  const inc = profile.readTranscriptTail;
  if (inc) {
    /* 轮转/收缩守卫:文件变小 = 重写,增量偏移失效,since=null 全量重来。 */
    const since = fileSize < (tail.offset ?? 0) ? null : tail.offset;
    const r = await inc(session, since).catch(() => null);
    if (!r) return null;
    tail.raw = since === null ? r.blocks : [...(tail.raw ?? []), ...r.blocks];
    tail.offset = r.offset;
    tail.truncated = r.truncated ?? tail.truncated;
    return { blocks: pairToolResults(tail.raw), truncated: tail.truncated };
  }
  const full = await profile.readSessionTranscript?.(session).catch(() => null);
  return full ? { blocks: full.blocks, truncated: full.truncated ?? false } : null;
}
