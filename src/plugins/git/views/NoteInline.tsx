/**
 * diff 行级批注行内件 —— 悬停「批注」小钮 / 行内输入态 / 行侧批注气泡。
 * 供 PatchLines 单栏渲染嵌入(CommitDiffTab 经 DiffPatchPane 注入 noteCtx 启用)。
 */
import { useEffect, useRef, useState } from "react";
import { ChatText } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { DiffNote } from "../diffNotes";

/** 行内输入态:Enter 提交 / Escape 取消 / Shift+Enter 换行;空内容禁提交。 */
export function NoteEditor({
  onCommit,
  onCancel,
}: {
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const commit = () => {
    const v = text.trim();
    if (v) onCommit(v);
    else onCancel();
  };
  return (
    <div className="my-1 ml-8 rounded border border-(--tmd-accent)/50 bg-(--tmd-bg) p-1.5">
      <textarea
        ref={ref}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={t("批注内容(Enter 提交,Shift+Enter 换行,Esc 取消)")}
        className="w-full resize-none bg-transparent text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
      />
      <div className="flex justify-end gap-1 text-meta">
        <button type="button" className="px-1.5 hover:text-(--tmd-fg)" onClick={onCancel}>
          {t("取消")}
        </button>
        <button
          type="button"
          disabled={!text.trim()}
          onClick={commit}
          className="rounded bg-(--tmd-accent)/15 px-1.5 text-(--tmd-accent) disabled:opacity-40"
        >
          {t("提交批注")}
        </button>
      </div>
    </div>
  );
}

/** 行侧批注气泡:头像「你」+ 两行截断(title 全文);sent 态淡绿。 */
export function NoteBubble({ note }: { note: DiffNote }) {
  return (
    <div
      className={`my-0.5 ml-8 flex items-start gap-1.5 rounded border px-1.5 py-1 ${
        note.sent
          ? "border-(--tmd-diff-inserted)/40 bg-(--tmd-diff-inserted)/10"
          : "border-(--tmd-border) bg-(--tmd-bg-hover)/60"
      }`}
      title={note.text}
    >
      <span className="shrink-0 rounded-full bg-(--tmd-accent)/20 px-1 text-meta text-(--tmd-accent)">
        {t("你")}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap text-meta text-(--tmd-fg-muted)">
        {note.text}
      </span>
    </div>
  );
}

/** 悬停小钮:行尾浮现,点击开行内输入态。 */
export function NoteHoverButton({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      aria-label={t("添加批注")}
      title={t("添加批注")}
      onClick={(e) => {
        e.stopPropagation();
        onStart();
      }}
      className="ml-auto shrink-0 self-center rounded px-1 text-(--tmd-fg-faint) opacity-0 group-hover:opacity-100 hover:text-(--tmd-accent)"
    >
      <ChatText weight="bold" className="h-3.5 w-3.5" />
    </button>
  );
}
