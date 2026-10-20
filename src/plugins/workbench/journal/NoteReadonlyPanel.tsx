/**
 * 便签只读态面板 —— 2026-10-20 从 NoteEditor.tsx 拆出(守 300 行铁则,
 * 零语义改动):便签卡 + 编辑钮 + 完成勾选(从昨日未完摘除)。
 */
import { PencilSimpleLine } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { NoteReadonly } from "./articleBody";
import type { DayNote, DayNoteImage } from "./journalFiles";

export function NoteReadonlyPanel({
  note,
  onImageOpen,
  onEdit,
  onToggleDone,
  onWriteNew,
}: {
  note: DayNote | undefined;
  onImageOpen?: (img: DayNoteImage) => void;
  onEdit: () => void;
  onToggleDone: () => void;
  onWriteNew: () => void;
}) {
  return (
    <div className={`dj-note-wrap${note?.checked ? " dj-note-done" : ""}`}>
      {note ? (
        <NoteReadonly note={note} onImageOpen={onImageOpen} />
      ) : (
        <button type="button" className="dj-nc-new" onClick={onWriteNew}>
          <PencilSimpleLine size="0.75rem" /> {t("给这一天写点什么(便签)")}
        </button>
      )}
      {note && (
        <button type="button" className="dj-nc-editbtn" onClick={onEdit}>
          {t("编辑")}
        </button>
      )}
      {note && (
        <button
          type="button"
          className="dj-nc-donebtn"
          aria-pressed={note.checked ?? false}
          title={
            note.checked ? t("恢复为未完成") : t("标记完成(从昨日未完摘除)")
          }
          onClick={onToggleDone}
        >
          {note.checked ? t("已完成") : t("标记完成")}
        </button>
      )}
    </div>
  );
}
