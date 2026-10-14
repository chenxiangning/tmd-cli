/**
 * anim · 会话卡片发送变换(session-relay relayCarry / workbench taskCard 同构):
 * pending 初始提示词卡前置 + 引用清单块后置,拼进下一条消息并消费;
 * 发送失败由 undo 恢复。空输入 = 仅卡片(空输入放行由插件注册 provider)。
 */
import type { ComposerSendTransform } from "@kernel/composerExt";
import {
  dropPendingPrompt,
  dropPendingRefs,
  getPendingPrompt,
  getPendingRefs,
  setPendingPrompt,
  setPendingRefs,
  type PendingAnimRef,
} from "./refStore";

let lastConsumed: { sessionId: string; prompt: string | null; refs: PendingAnimRef[] } | null = null;

export const animRefsSendTransform: ComposerSendTransform = (text, sessionId) => {
  if (!sessionId) return text;
  const prompt = getPendingPrompt(sessionId);
  const refs = getPendingRefs(sessionId);
  if (prompt === null && refs.length === 0) return text;
  lastConsumed = { sessionId, prompt, refs };
  if (prompt !== null) dropPendingPrompt(sessionId);
  if (refs.length > 0) dropPendingRefs(sessionId);
  const block = refs.length > 0
    ? ["引用文件:", ...refs.map((ref) => `- ${ref.label}:${ref.path}`)].join("\n")
    : null;
  return [prompt, text, block]
    .filter((part) => part !== null && part !== "")
    .join("\n\n");
};

/** 发送失败回滚:恢复最后一次消费的卡片与引用(幂等,无消费 no-op)。 */
export function undoAnimRefsSend(): void {
  if (!lastConsumed) return;
  if (lastConsumed.prompt !== null) setPendingPrompt(lastConsumed.sessionId, lastConsumed.prompt);
  if (lastConsumed.refs.length > 0) setPendingRefs(lastConsumed.sessionId, lastConsumed.refs);
  lastConsumed = null;
}
