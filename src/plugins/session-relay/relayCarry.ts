/**
 * 接力芯片发送变换 —— pending 摘要前置拼装 + 消费/回滚(marks sendTransform
 * 同款乐观口径:变换内消费,全部目标写失败经 registerComposerSendUndo 恢复)。
 * 拼装形态:摘要 + 空行 + 用户输入(空输入 = 仅摘要,接力首发主路径)。
 */
import type { ComposerSendTransform } from "@kernel/composerExt";
import { dropPendingRelay, getPendingRelay, setPendingRelay, type PendingRelayPayload } from "./relayStore";

let lastConsumed: { sessionId: string; payload: PendingRelayPayload } | null = null;

export const relaySendTransform: ComposerSendTransform = (text, sessionId) => {
  if (!sessionId) return text;
  const payload = getPendingRelay(sessionId);
  if (!payload) return text;
  lastConsumed = { sessionId, payload };
  dropPendingRelay(sessionId);
  return text ? `${payload.text}\n\n${text}` : payload.text;
};

/** 发送失败回滚:恢复最后一次消费的芯片载荷(幂等,无消费 no-op)。 */
export function undoRelaySend(): void {
  if (!lastConsumed) return;
  setPendingRelay(lastConsumed.sessionId, lastConsumed.payload);
  lastConsumed = null;
}
