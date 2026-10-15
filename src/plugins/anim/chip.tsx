/**
 * Composer 引用卡片条 —— anim 贡献给 composer.attachments 挂点的组件
 * (workbench TaskCardChip 同款先例)。「AI 会话」确认后的初始提示词卡
 * (点击弹编辑弹层改全文,更新/丢弃)+ 协议材料/目标项目引用芯片
 * (✕ 逐条移除);发送变换消费后整条自动消失。
 */
import { useState } from "react";
import { FileText, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { host } from "@kernel/host";
import {
  dropPendingRef,
  dropPendingPrompt,
  setPendingPrompt,
  usePendingPrompt,
  usePendingRefs,
} from "./refStore";

/** 提示词卡编辑弹层(任务卡片编辑态同款两键:更新写回 pending,取消不动)。 */
function PromptEditDialog({ sessionId, text, onClose }: {
  sessionId: string;
  text: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(text);
  return (
    <DialogShell
      title={t("初始提示词")}
      icon={null}
      width={520}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("更新")}
          confirmDisabled={!draft.trim()}
          onConfirm={() => {
            setPendingPrompt(sessionId, draft.trim());
            onClose();
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1 text-xs text-(--tmd-fg-muted)" htmlFor="anim-prompt-card-edit">
          {t("提示词随下一条消息一并发出;空输入 = 仅发卡片")}
        </label>
        <textarea
          id="anim-prompt-card-edit"
          className="w-full resize-y rounded border border-(--tmd-border) bg-(--tmd-bg-subtle) p-2 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
          rows={9}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
    </DialogShell>
  );
}

export function AnimRefChips() {
  const sessionId = host.getActiveSessionId();
  const prompt = usePendingPrompt(sessionId);
  const refs = usePendingRefs(sessionId);
  const [editing, setEditing] = useState(false);
  if (!sessionId || (prompt === null && refs.length === 0)) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-(--tmd-border) px-2.5 py-1.5"
      aria-label={t("引用文件")}
    >
      {prompt !== null && (
        <div
          className="inline-flex items-center gap-1 rounded-full border border-(--tmd-accent) py-px pl-1.5 pr-1 text-meta text-(--tmd-fg)"
          title={prompt}
        >
          <button
            type="button"
            className="inline-flex max-w-56 cursor-pointer items-center gap-1"
            onClick={() => setEditing(true)}
          >
            <span className="truncate">{t("初始提示词")}</span>
          </button>
          <button
            type="button"
            aria-label={t("丢弃初始提示词")}
            className="inline-flex cursor-pointer items-center text-(--tmd-fg-subtle) hover:text-(--tmd-fg)"
            onClick={() => dropPendingPrompt(sessionId)}
          >
            <X size="0.75rem" aria-hidden />
          </button>
        </div>
      )}
      <span className="text-meta text-(--tmd-fg-faint)">{t("引用文件")}</span>
      {refs.map((ref) => (
        <div
          key={ref.path}
          className="inline-flex items-center gap-1 rounded-full border border-(--tmd-accent) py-px pl-1.5 pr-1 text-meta text-(--tmd-fg)"
          title={ref.path}
        >
          <FileText size="0.75rem" className="text-(--tmd-accent)" aria-hidden />
          {t(ref.label)}
          <button
            type="button"
            aria-label={t("移除引用 {label}", { label: t(ref.label) })}
            className="inline-flex cursor-pointer items-center text-(--tmd-fg-subtle) hover:text-(--tmd-fg)"
            onClick={() => dropPendingRef(sessionId, ref.path)}
          >
            <X size="0.75rem" aria-hidden />
          </button>
        </div>
      ))}
      {editing && prompt !== null ? (
        <PromptEditDialog sessionId={sessionId} text={prompt} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
