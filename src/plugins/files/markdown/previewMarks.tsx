/**
 * md 预览标记 UI —— 块级 ⚑ 悬停按钮 / 已标记徽章 / 标记交互卡。
 * 自 FileMarkdownPreview 拆出(文件规模铁则);动作经 markBridge 事件总线
 * 发射给 marks 插件(插件间零 import)。
 */

import { t } from "@kernel/i18n";
import { emitFileMarkAction, requestFileMark, type FileMarkLite } from "../markBridge";

/** 块包装右上角的标记控件区:徽章(点击开合交互卡)+ 悬停 ⚑ 落锚。 */
export function PreviewMarkControls({
  sourceFilePath,
  startLine,
  endLine,
  blockKey,
  blockMarks,
  open,
  onToggle,
}: {
  sourceFilePath: string | null;
  startLine: number;
  endLine: number;
  blockKey: string;
  blockMarks: FileMarkLite[];
  open: boolean;
  onToggle: (key: string | null) => void;
}) {
  return (
    <>
      {blockMarks.length > 0 ? (
        <button
          type="button"
          title={t("查看标记")}
          className="absolute right-1 top-0.5 z-10 cursor-pointer rounded-full bg-(--tmd-warn) px-1 text-[0.6rem] leading-3 text-(--tmd-bg-base)"
          onClick={() => onToggle(open ? null : blockKey)}
        >
          ⚑{blockMarks.length}
        </button>
      ) : null}
      {open && blockMarks.length > 0 ? (
        <div className="absolute right-1 top-5 z-20 w-64 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 text-xs shadow-lg">
          {blockMarks.map((mark) => (
            <div key={mark.id} className="mb-2 border-b border-(--tmd-border) pb-2 last:mb-0 last:border-0 last:pb-0">
              <div className="mb-1 flex items-center gap-1.5 text-(--tmd-fg-muted)">
                <span className="text-(--tmd-warn)">⚑</span>
                L{mark.startLine}
                {mark.endLine !== mark.startLine ? `-${mark.endLine}` : ""}
                <span className="ml-auto text-(--tmd-fg-faint)">{mark.stateLabel}</span>
                <button
                  type="button"
                  className="cursor-pointer text-(--tmd-err) hover:opacity-80"
                  title={t("移除标记")}
                  onClick={() => emitFileMarkAction({ id: mark.id, op: "remove" })}
                >
                  ×
                </button>
              </div>
              <textarea
                rows={2}
                defaultValue={mark.note}
                placeholder={t("写标注,随引用发送到对话…")}
                className="w-full resize-y rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-1.5 text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
                onBlur={(event) => emitFileMarkAction({ id: mark.id, op: "note", note: event.target.value })}
              />
              {mark.state !== "staged" && mark.state !== "sent" ? (
                <button
                  type="button"
                  className="mt-1 w-full cursor-pointer rounded-md border border-(--tmd-warn) py-0.5 text-(--tmd-warn) hover:bg-(--tmd-bg-hover)"
                  onClick={() => emitFileMarkAction({ id: mark.id, op: "stage" })}
                >
                  {t("⚑ 发送到对话")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        title={t("标记此块,随下次发送带上")}
        className={`absolute top-0.5 z-10 cursor-pointer rounded-md border border-(--tmd-warn) bg-(--tmd-bg-base) px-1 text-[0.65rem] text-(--tmd-warn) opacity-0 transition-opacity group-hover/mark:opacity-100 ${blockMarks.length > 0 ? "right-8" : "right-1"}`}
        onClick={() => {
          if (!sourceFilePath) return;
          requestFileMark({ path: sourceFilePath, startLine, endLine });
        }}
      >
        ⚑
      </button>
    </>
  );
}
