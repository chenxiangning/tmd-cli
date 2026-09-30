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

/** 轮询决策(纯函数,单测钉死熔断语义):
 * - 未定位磁盘会话:回 relocate(重定位尝试;列表 miss 由调用方保持等待,
 *   覆盖 omp 新会话 jsonl 懒落盘场景,不改失败计数);
 * - 已定位但探测失败:第一次回 relocate 容瞬态;重定位命中后再探错 = 路径
 *   非可读文件(kimi/grok 会话目录、opencode/dsh 合成串),回 terminal 熔断;
 * - 探测成功:有变更回 read,无变更回 idle 继续等待。 */
export function decideProbe(
  resolved: boolean,
  probe: { changed: boolean } | null,
  failStreak: number,
): { decision: ProbeDecision; failStreak: number } {
  if (!resolved) return { decision: "relocate", failStreak };
  if (!probe) {
    return failStreak > 0
      ? { decision: "terminal", failStreak: 0 }
      : { decision: "relocate", failStreak: 1 };
  }
  return probe.changed
    ? { decision: "read", failStreak: 0 }
    : { decision: "idle", failStreak: 0 };
}
