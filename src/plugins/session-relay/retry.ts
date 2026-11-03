/**
 * 上一回合重试:读取真实用户消息、关联原轮批次,确认后仅挂 composer pending。
 * 不调用 writeSession;跨引擎仍由既有 relay 对话框负责。
 */
import type { CliUserMessage } from "@kernel/cli";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { ipc, type CkptBatch } from "@kernel/ipc";
import { messageAnchors } from "@kernel/messageAnchors";
import type { RetryOpenDetail } from "@kernel/relayBridge";
import { setPendingPrompt } from "@kernel/sessionPending";
import { composerReplaceRef } from "@kernel/composerExt";
import { t } from "@kernel/i18n";
import { isWrapperText } from "../cli-shared/userMessages";
import { matchTurnBatches } from "../checkpoints/turnMatch";

export type RetrySource = RetryOpenDetail;

export interface RetryPreview {
  text: string;
  batch?: CkptBatch;
}

export interface RetryTurnPreview extends RetryPreview {
  id: string;
  /** 原始用户消息 1-based 轮号,含被过滤的控制命令。 */
  index: number;
}

/** 控制命令、XML/AGENTS 包装与接力外壳都不是可重试的任务正文。 */
export function isRetryTaskText(text: string): boolean {
  const trimmed = text.trim();
  return !!trimmed && !trimmed.startsWith("/") && !trimmed.startsWith("接力自 ") && !isWrapperText(trimmed);
}

export function lastRetryTurn(turns: readonly CliUserMessage[]): CliUserMessage | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (isRetryTaskText(turns[i].text)) return turns[i];
  }
  return null;
}

async function readDiskTurns(source: RetrySource): Promise<readonly CliUserMessage[]> {
  if (!source.cliSessionId) return [];
  const profile = host.getCliProfile(source.profileId);
  if (profile?.readSessionUserMessages) {
    const turns = await profile.readSessionUserMessages(source.cwd, source.cliSessionId, true).catch(() => null);
    if (turns && lastRetryTurn(turns)) return turns;
  }
  if (!profile?.readSessionTranscript || !profile.listSessions) return [];
  const sessions = await profile.listSessions(source.cwd).catch(() => null);
  const disk = sessions?.find((s) => s.id === source.cliSessionId);
  if (!disk) return [];
  const transcript = await profile.readSessionTranscript(disk).catch(() => null);
  return transcript?.blocks.filter((b) => b.role === "user").map((b) => ({ id: b.id, text: b.text })) ?? [];
}

/** 当前活会话缓存优先,磁盘用户消息/转录兜底;批次按原轮号与全文双闸配对。 */
export async function loadRetryTurns(source: RetrySource): Promise<RetryTurnPreview[]> {
  const live = messageAnchors.getAnchors(source.sessionId ?? null);
  const turns = lastRetryTurn(live) ? live : await readDiskTurns(source);
  if (!lastRetryTurn(turns)) return [];
  const batches = source.cliSessionId && source.cwd
    ? await ipc.checkpointList(source.cwd, source.cliSessionId, source.sessionId).catch(() => [])
    : [];
  const matched = matchTurnBatches(turns, batches);
  return turns.flatMap((turn, index) => isRetryTaskText(turn.text)
    ? [{ id: turn.id, index: index + 1, text: turn.text, batch: matched.get(turn.id) }]
    : []).reverse();
}

/** 兼容单条预览调用;完整候选由 loadRetryTurns 提供。 */
export async function loadRetryPreview(source: RetrySource): Promise<RetryPreview | null> {
  const selected = (await loadRetryTurns(source))[0];
  return selected ? { text: selected.text, batch: selected.batch } : null;
}

/** 只有目标会话已接管 composer 才允许整替;旧 composer 必须拒绝写入。 */
async function replaceLivePrompt(sessionId: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (composerReplaceRef.current?.(text, sessionId)) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new Error(t("输入框尚未就绪,请稍后重试"));
}

/** 活会话直接替换草稿;已退出先恢复,再经 pending 芯片等待 composer 接管。绝不自动发送。 */
export async function confirmRetry(source: RetrySource, text: string): Promise<void> {
  const live = source.sessionId && host.getSessions().some((s) => s.id === source.sessionId);
  if (!live && !source.cliSessionId) throw new Error(t("会话尚未落盘,无法重试"));
  const sessionId = live
    ? source.sessionId!
    : (await host.openDiskSession(source.profileId, source.cwd, source.workspaceId, source.cliSessionId!)).id;
  host.events.emit(KernelTopics.sessionViewRequested, null);
  host.setActiveSession(sessionId);
  if (live) await replaceLivePrompt(sessionId, text);
  else setPendingPrompt(sessionId, text);
}
