/**
 * 「本回合批注」面板 —— CommitDiffTab patch 区底部的批注清单 + 回传主钮。
 * 数据源 diffNotes(sessionKey 分组);回传 = 拼结构化文本经 composer 插入桥
 * 填输入框(不自动发送),成功后整组标 sent。
 */
import { useState } from "react";
import { composerInsertRef } from "@kernel/composerExt";
import { t } from "@kernel/i18n";
import { CheckCircle, Trash } from "@phosphor-icons/react";
import {
  diffNoteRevealRef,
  noteKey,
  toggleSent,
  remove,
  useDiffNotesStore,
  type DiffNote,
} from "../diffNotes";

/** 会话徽标:会话 id 截短,工作区回落组标「工作区」。 */
function sessionBadge(sessionKey: string): string {
  if (sessionKey.startsWith("ws:")) return t("工作区");
  return sessionKey.slice(0, 8);
}

/** 回传文本:按文件排序聚块,每批注一带行锚(hash)与 excerpt 引文。 */
export function buildNoteReport(notes: readonly DiffNote[]): string {
  const sorted = [...notes].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.lineNo - b.lineNo));
  const blocks = sorted.map(
    (n) => `文件 ${n.file}#${n.lineHash} 行 ${n.lineNo}:\n> ${n.excerpt}\n批注:${n.text}`,
  );
  return `代码批注回传:\n\n${blocks.join("\n\n")}`;
}

export function DiffNotesPanel({ sessionKey }: { sessionKey: string }) {
  const store = useDiffNotesStore();
  const notes = store.groups[sessionKey] ?? [];
  const [toast, setToast] = useState<string | null>(null);
  const pending = notes.filter((n) => !n.sent); /* 已 sent 不重发:新批注解锁按钮。 */
  const canSend = pending.length > 0;

  const send = () => {
    /* composer 未挂载(无活跃会话/shell tab)时 ref 为空:置位 sent 前先闸,
     * 否则报告静默丢弃且回传钮永久禁用(DocGenFoot 同闸先例)。 */
    if (!composerInsertRef.current) {
      setToast(t("输入框未就绪,打开会话后再回传"));
      window.setTimeout(() => setToast(null), 2400);
      return;
    }
    if (!canSend) return;
    composerInsertRef.current(buildNoteReport(pending));
    for (const n of pending) toggleSent(sessionKey, n.id);
    setToast(t("已填入输入框,按 Enter 发送"));
    window.setTimeout(() => setToast(null), 2400);
  };

  return (
    <div className="shrink-0 border-t border-(--tmd-border)">
      <div className="flex items-center gap-1.5 px-3 py-1 text-meta text-(--tmd-fg-muted)">
        <span>{t("本回合批注 ({n})", { n: notes.length })}</span>
        <span
          className="rounded bg-(--tmd-bg-hover) px-1 text-(--tmd-fg-faint)"
          title={sessionKey}
        >
          {sessionBadge(sessionKey)}
        </span>
        <span className="flex-1" />
        {toast && <span className="text-(--tmd-diff-inserted)">{toast}</span>}
      </div>
      <div className="max-h-36 overflow-y-auto px-3">
        {notes.length === 0 && (
          <div className="py-1.5 text-meta text-(--tmd-fg-faint)">
            {t("还没有批注;在 diff 行悬停点批注钮添加")}
          </div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="group flex items-start gap-1.5 py-0.5 text-meta">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left hover:text-(--tmd-fg)"
              title={`${n.file}#${n.lineHash}:${n.lineNo}\n${n.text}`}
              onClick={() => diffNoteRevealRef.current?.(noteKey(n.file, n.lineHash))}
            >
              <span className="font-mono text-(--tmd-accent)">{n.file.split("/").pop()}:{n.lineNo}</span>{" "}
              <span className={n.sent ? "text-(--tmd-diff-inserted)" : "text-(--tmd-fg-muted)"}>{n.text}</span>
            </button>
            {n.sent && <CheckCircle weight="fill" className="mt-0.5 h-3 w-3 shrink-0 text-(--tmd-diff-inserted)" />}
            <button
              type="button"
              aria-label={t("删除批注")}
              className="shrink-0 text-(--tmd-fg-faint) opacity-0 group-hover:opacity-100 hover:text-(--tmd-diff-removed)"
              onClick={() => remove(sessionKey, n.id)}
            >
              <Trash className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5">
        <button
          type="button"
          disabled={!canSend}
          title={
            notes.length > 0 && !canSend
              ? t("已回传")
              : notes.length === 0
                ? t("没有可回传的批注")
                : undefined
          }
          onClick={send}
          className={`flex w-full items-center justify-center gap-1 rounded py-1 text-xs ${
            canSend
              ? "bg-(--tmd-accent) text-(--tmd-bg)"
              : "cursor-not-allowed bg-(--tmd-bg-hover) text-(--tmd-fg-faint)"
          }`}
        >
          {notes.length > 0 && !canSend ? (
            <>
              <CheckCircle weight="fill" className="h-3.5 w-3.5" /> {t("已回传 · 共 {n} 条", { n: notes.length })}
            </>
          ) : (
            t("回传给 agent({n} 条)", { n: pending.length })
          )}
        </button>
      </div>
    </div>
  );
}
