/**
 * 便签编辑器(文章 tab 内「我的便签」区)—— 编辑态完全本地草稿(文本+图片),
 * ⌘/Ctrl+回车保存、Esc 取消、⌘V 直接粘贴截图(落 assets/,保存时随存);
 * 清空文本且无图 = 删除便签。空日点月格自动进入编辑态(payload.autoEdit)。
 */
import { useEffect, useRef, useState } from "react";
import { PencilSimpleLine } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { saveNote } from "./journalStore";
import type { DayNote, DayNoteImage } from "./journalFiles";
import { savePastedImage } from "./noteAssets";
import { NoteImage, NoteReadonly } from "./articleBody";

function enterEdit(note: DayNote | undefined): [string, DayNoteImage[]] {
  return [note?.text ?? "", [...(note?.images ?? [])]];
}

export function NoteEditor({
  y,
  m,
  d,
  note,
  signal,
  onImageOpen,
}: {
  y: number;
  m: number;
  d: number;
  note: DayNote | undefined;
  /** 编辑重入边沿信号(0 = 不进;每次跳变 = 以当前便签为草稿进编辑态)。 */
  signal: number;
  /** 只读态点缩略图开大图(编辑态无此交互)。 */
  onImageOpen?: (img: DayNoteImage) => void;
}) {
  /* 信号 > 0 = 进入编辑态(ArticleTab 以 key={signal} 重挂驱动重入,草稿随之换新)。 */
  const [editing, setEditing] = useState(signal > 0);
  const [text, setText] = useState(note?.text ?? "");
  const [images, setImages] = useState<DayNoteImage[]>(note?.images ?? []);
  const [pasteErr, setPasteErr] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <div className="dj-note-wrap">
        {note ? (
          <NoteReadonly note={note} onImageOpen={onImageOpen} />
        ) : (
          <button type="button" className="dj-nc-new" onClick={() => setEditing(true)}>
            <PencilSimpleLine size={11} /> {t("给这一天写点什么(便签)")}
          </button>
        )}
        {note && (
          <button
            type="button"
            className="dj-nc-editbtn"
            onClick={() => {
              const [t0, i0] = enterEdit(note);
              setText(t0);
              setImages(i0);
              setSaveErr(false);
              setEditing(true);
            }}
          >
            {t("编辑")}
          </button>
        )}

      </div>
    );
  }

  const save = async () => {
    const trimmed = text.trim();
    const next: DayNote | null = trimmed || images.length ? { text: trimmed, images, updatedAt: Date.now() } : null;
    setSaveErr(false);
    try {
      await saveNote(y, m, d, next);
      setEditing(false);
    } catch {
      setSaveErr(true); /* 写盘失败保持编辑态,内容不丢 */
    }
  };
  const cancel = () => {
    const [t0, i0] = enterEdit(note);
    setText(t0);
    setImages(i0);
    setEditing(false);
  };
  /* 脏稿判定:文本或图片集与已存便签有差 = 有未保存内容(Esc 弃稿前确认用)。 */
  const dirty =
    text !== (note?.text ?? "") ||
    images.length !== (note?.images?.length ?? 0) ||
    images.some((img, i) => img.file !== note?.images?.[i]?.file);
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...(e.clipboardData?.items ?? [])].find((it) => it.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const blob = item.getAsFile();
    if (!blob) return;
    void savePastedImage(y, m, d, blob, blob.name).then((img) => {
      if (img) setImages((prev) => [...prev, img]);
      else setPasteErr(true);
    });
  };

  return (
    <div className="dj-notecard">
      <div className="dj-nc-head">
        <PencilSimpleLine size={11} /> {t("我的便签")}
      </div>
      <div className="dj-nc-editbox">
        <textarea
          ref={taRef}
          className="dj-nc-edit"
          value={text}
          placeholder={t("写点什么… ⌘/Ctrl+回车保存,Esc 取消,⌘V 可贴截图")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return; /* IME 组词期放行(仓内纪律):Esc 消候选不撤销编辑器 */
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
            /* Esc 弃稿:有未保存内容先确认(误按最高频的丢稿源);按钮取消是显式操作不拦。 */
            if (e.key === "Escape" && (!dirty || window.confirm(t("便签有未保存修改,丢弃?")))) cancel();
          }}
          onPaste={onPaste}
        />
        {pasteErr && <div className="dj-nc-pasteerr">{t("图片保存失败,请重试")}</div>}
        {saveErr && <div className="dj-nc-pasteerr">{t("保存失败,请重试")}</div>}
        {images.length > 0 && (
          <div className="dj-nc-imgs">
            {images.map((img, i) => (
              <NoteImage key={img.file} img={img} editing onDelete={() => setImages((prev) => prev.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}
        <div className="dj-nc-foot">
          <span>{t("与 AI 文章独立落盘 · 重新生成不碰便签")}</span>
          <div className="dj-nc-acts">
            <button type="button" className="dj-btn" onClick={cancel}>
              {t("取消")}
            </button>
            <button type="button" className="dj-btn dj-btn-primary" onClick={save}>
              {t("保存 ⌘↵")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
