/**
 * 发送变换 —— 两件事,marks sendTransform 同构:
 * ① pending 画布附件:序列化为结构化 JSON 上下文块拼进 prompt,发送成功清空,
 *    失败由 undo 恢复;
 * ② AI 作画开:尾部追加作画指令段(inbox 路径 + schema),AI 写文件 → 画布轮询导入。
 * composerExt transform 为同步签名:inbox 路径用 aiDrawPrompt 的缓存(画布 tab
 * 挂载/轮询时刷新),无缓存 = 本会话没开过画布,不注入。
 */

import { registerComposerSendUndo, registerComposerSendTransform, type ComposerSendTransform } from "@kernel/composerExt";
import { host } from "@kernel/host";
import { getActiveWorkspace } from "@kernel/workspace";
import type { IntentCanvasDocument } from "./types";
import { formatIntentCanvasThreadContext } from "./utils/contextFormat";
import { consumeAttachments, restoreAttachments } from "./store";
import { aiDrawPref } from "./aiDrawStore";
import { aiDrawInboxPathSync, buildAiDrawInstruction } from "./aiDrawPrompt";
import { activeDocumentRef } from "./activeDocumentBridge";

let lastConsumed: { sessionId: string; documents: IntentCanvasDocument[] } | null = null;

export const intentCanvasSendTransform: ComposerSendTransform = (text, sessionId) => {
  const root = getActiveWorkspace()?.root;
  if (!root) {
    return text;
  }
  /* 每次运行即新一轮发送:先失效旧消费名单,防上一封成功附件被本轮失败的
     undo 错误恢复(marks 2026-09-20 复查 P1 同款残留闸)。 */
  lastConsumed = null;
  const effectiveSessionId = sessionId ?? host.getActiveSessionId();
  let next = text;

  /* 附件:只在目标会话有 pending 时注入。 */
  if (effectiveSessionId) {
    const documents = consumeAttachments(effectiveSessionId);
    if (documents.length > 0) {
      lastConsumed = { sessionId: effectiveSessionId, documents };
      const workspaceName = getActiveWorkspace()?.name ?? null;
      next = `${next}\n\n${documents
        .map((document) => formatIntentCanvasThreadContext(document, workspaceName))
        .join("\n\n")}`;
    }
  }

  /* AI 作画:开关开 + inbox 路径已缓存,追加指令段。 */
  if (aiDrawPref().enabled) {
    const inboxPath = aiDrawInboxPathSync(root);
    if (inboxPath) {
      next = `${next}\n\n${buildAiDrawInstruction(inboxPath, activeDocumentRef.current)}`;
    }
  }
  return next;
};

export function undoIntentCanvasSendTransform(): void {
  if (lastConsumed) {
    restoreAttachments(lastConsumed.sessionId, lastConsumed.documents);
    lastConsumed = null;
  }
}

/* 反注册闭包:activate 返回给插件生命周期(marks/assets 同款,防熔断后双份注入)。 */
export function registerIntentCanvasSendTransform(): () => void {
  const offTransform = registerComposerSendTransform(intentCanvasSendTransform);
  const offUndo = registerComposerSendUndo(undoIntentCanvasSendTransform);
  return () => {
    offTransform();
    offUndo();
  };
}
