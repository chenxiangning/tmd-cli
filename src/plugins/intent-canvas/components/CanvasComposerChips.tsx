/**
 * Composer 附件区 —— 意图画布贡献给 composer.attachments 挂点。
 * 「关联当前会话」的画布渲染为一行式引用芯片(marks 同构):标题点击反链
 * 直达画布,✕ 退回 pending,不随消息注入。
 */

import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { IntentCanvasAttachmentCard } from "./IntentCanvasAttachmentCard";
import { usePendingAttachments, unstageAttachment } from "../store";

export function CanvasComposerChips() {
  const sessionId = host.getActiveSessionId();
  const pending = usePendingAttachments(sessionId);
  if (!sessionId || pending.length === 0) {
    return null;
  }
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-(--tmd-border) px-2.5 py-1.5"
      aria-label={t("已关联的意图画布")}
    >
      <span className="text-[0.65rem] text-(--tmd-fg-faint)">{t("画布引用")}</span>
      {pending.map((document) => (
        <IntentCanvasAttachmentCard
          key={document.id}
          document={document}
          onRemove={(documentId) => unstageAttachment(sessionId, documentId)}
        />
      ))}
    </div>
  );
}
