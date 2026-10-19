/**
 * anim · 会话卡片发送变换(session-relay relayCarry / workbench taskCard 同构):
 * 引用清单块后置拼进下一条消息并消费;发送失败由 undo 恢复。空输入 = 仅卡片
 * (空输入放行由插件注册 provider)。pending 初始提示词半区已上移 kernel
 * (@kernel/sessionPending 的 pendingPromptSendTransform),本模块只留 refs 半区。
 */
import type { ComposerSendTransform } from "@kernel/composerExt";
import {
  dropPendingRefs,
  getPendingRefs,
  setPendingRefs,
  type PendingAnimRef,
} from "./refStore";

let lastConsumed: { sessionId: string; refs: PendingAnimRef[] } | null = null;

export const animRefsSendTransform: ComposerSendTransform = (text, sessionId) => {
  if (!sessionId) return text;
  const refs = getPendingRefs(sessionId);
  if (refs.length === 0) return text;
  lastConsumed = { sessionId, refs };
  dropPendingRefs(sessionId);
  const block = ["引用文件:", ...refs.map((ref) => `- ${ref.label}:${ref.path}`)].join("\n");
  return [text, block]
    .filter((part) => part !== "")
    .join("\n\n");
};

/** 发送失败回滚:恢复最后一次消费的引用(幂等,无消费 no-op)。 */
export function undoAnimRefsSend(): void {
  if (!lastConsumed) return;
  if (lastConsumed.refs.length > 0) setPendingRefs(lastConsumed.sessionId, lastConsumed.refs);
  lastConsumed = null;
}
