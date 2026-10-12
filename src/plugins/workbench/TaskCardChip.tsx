/**
 * Composer 任务卡片芯片条 —— workbench 贡献给 composer.attachments 挂点的组件
 * (session-relay 接力芯片同款先例)。pending 任务卡片渲染为芯片:关联会话
 * 名称 + 「卡片」标记,点击弹编辑弹层改全文(更新/丢弃),✕ 直接丢弃;
 * 发送变换(taskCard.ts)消费后自动消失。
 */

import { useState } from "react";
import { Kanban, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { host } from "@kernel/host";
import { dropPendingTaskCard, setPendingTaskCard, usePendingTaskCard, type PendingTaskCard } from "./taskCard";

/** 卡片编辑弹层(接力编辑态同款两键:更新写回 pending,丢弃摘除芯片)。 */
function TaskCardEditDialog({ sessionId, card, onClose }: {
  sessionId: string;
  card: PendingTaskCard;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(card.text);
  return (
    <DialogShell
      title={t("任务卡片")}
      icon={null}
      width={520}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("更新")}
          confirmDisabled={!draft.trim()}
          onConfirm={() => {
            setPendingTaskCard(sessionId, { ...card, text: draft.trim() });
            onClose();
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="wb-fieldform wb-modal-body">
        <label className="wb-field">
          <span>{t("任务上下文(随下一条消息一并发出;空输入 = 仅发卡片)")}</span>
          <textarea
            className="wb-doc-editor" rows={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      </div>
    </DialogShell>
  );
}

export function TaskCardChip() {
  const sessionId = host.getActiveSessionId();
  const card = usePendingTaskCard(sessionId);
  const [editing, setEditing] = useState(false);
  if (!sessionId || !card) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-(--tmd-border) px-2.5 py-1.5">
      <span className="text-meta text-(--tmd-fg-faint)">{t("任务卡片")}</span>
      <div
        className="inline-flex items-center gap-1 rounded-full border border-(--tmd-accent) py-px pl-1.5 pr-1 text-meta text-(--tmd-fg)"
        title={card.title}
      >
        <button
          type="button"
          className="inline-flex max-w-56 cursor-pointer items-center gap-1"
          onClick={() => setEditing(true)}
        >
          <Kanban size="0.75rem" className="shrink-0 text-(--tmd-accent)" aria-hidden />
          <span className="truncate">{card.title}</span>
        </button>
        <button
          type="button"
          aria-label={t("丢弃任务卡片")}
          className="inline-flex cursor-pointer items-center text-(--tmd-fg-subtle) hover:text-(--tmd-fg)"
          onClick={() => dropPendingTaskCard(sessionId)}
        >
          <X size="0.75rem" aria-hidden />
        </button>
      </div>
      {editing ? <TaskCardEditDialog sessionId={sessionId} card={card} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
