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
