/**
 * 便签编辑器(文章 tab 内「我的便签」区)—— 编辑态完全本地草稿(文本+图片),
 * ⌘/Ctrl+回车保存、Esc 取消、⌘V 直接粘贴截图;清空文本且无图 = 删除便签。
 * 只读态面板在同目录 NoteReadonlyPanel.tsx。
 */
import { useEffect, useRef, useState } from "react";
import { PencilSimpleLine } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { draftMirrorClear, draftMirrorGet, draftMirrorSet } from "@kernel/draftMirror";
import { DraftMirrorBar } from "@kernel/draftMirrorBar";
import { saveNote } from "./journalStore";
import { noteMirrorSlot, type DayNote, DayNoteImage } from "./journalFiles";
import { savePastedImage } from "./noteAssets";
import { NoteImage } from "./articleBody";
import { NoteReadonlyPanel } from "./NoteReadonlyPanel";

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
  onDirtyChange,
}: {
  y: number;
  m: number;
  d: number;
  note: DayNote | undefined;
  /** 编辑重入边沿信号(0 = 不进;每次跳变 = 以当前便签为草稿进编辑态)。 */
  signal: number;
  /** 只读态点缩略图开大图(编辑态无此交互)。 */
  onImageOpen?: (img: DayNoteImage) => void;
  /** 脏态上浮(评审 M1):编辑中与已存便签有差即 true;ArticleTab 统一持有
   *  并镜像 kernel tab 脏圆点 + openArticleTab 放行闸。 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  /* 信号 > 0 = 进入编辑态(ArticleTab 以 key={signal} 重挂驱动重入,草稿随之换新)。 */
  const [editing, setEditing] = useState(signal > 0);
  const [text, setText] = useState(note?.text ?? "");
  const [images, setImages] = useState<DayNoteImage[]>(note?.images ?? []);
  const [pasteErr, setPasteErr] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  /* 保存期间禁用按钮(C6):慢盘/大图落 assets 连按会重入写链。 */
  const [saving, setSaving] = useState(false);
  /* Esc 弃稿确认弹层态:脏稿 Esc 不直接丢,先弹 ConfirmDialog(弹层 Esc/背板=取消弃稿,确认=执行 cancel)。 */
  const [askDiscard, setAskDiscard] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  /* 脏稿判定:文本或图片集与已存便签有差 = 有未保存内容(Esc 弃稿前确认用)。 */
  const baseText = note?.text ?? "";
  const baseImages = note?.images;
  const isDirtyWith = (t: string, imgs: DayNoteImage[]) =>
    t !== baseText ||
    imgs.length !== (baseImages?.length ?? 0) ||
    imgs.some((img, i) => img.file !== baseImages?.[i]?.file);
  const dirty = isDirtyWith(text, images);
  /* 脏态上浮在变更点直报(react-doctor 禁 prop 回调进 effect):六个变更入口各自调。 */
  const reportDirty = (editingNow: boolean, t: string, imgs: DayNoteImage[]) => {
    onDirtyChange?.(editingNow && isDirtyWith(t, imgs));
    /* 镜像随行(0.4.0 项 12):脏 = 跟写(防抖落盘),不脏(已保存/弃稿)= 清,与草稿同生命周期。 */
    if (editingNow && isDirtyWith(t, imgs)) draftMirrorSet(noteMirrorSlot(y, m, d), t);
    else draftMirrorClear(noteMirrorSlot(y, m, d));
  };
  /* 草稿镜像恢复条(派生态):与当前文本有差才显,跟写/回填等值即自隐,丢弃清镜像即消失。 */
  const mirrorEntry = editing ? draftMirrorGet(noteMirrorSlot(y, m, d)) : null;
  const mirrorBar = mirrorEntry && mirrorEntry.text !== text ? mirrorEntry : null;
  const restoreMirrorBar = () => {
    if (!mirrorBar) return;
    setText(mirrorBar.text);
    reportDirty(true, mirrorBar.text, images);
  };

  if (!editing) {
    return (
      <>
        <NoteReadonlyPanel
          note={note}
          onImageOpen={onImageOpen}
          onEdit={() => {
            const [t0, i0] = enterEdit(note);
            setText(t0);
            setImages(i0);
            setSaveErr(false);
            setEditing(true);
            reportDirty(true, t0, i0);
          }}
          onToggleDone={() => {
            if (!note) return;
            /* 只翻勾选态(内容编辑另有入口);先清旧错:成功路径不残留上轮错误(评审 L17)。 */
            setSaveErr(false);
            void saveNote(
              y,
              m,
              d,
              note.checked
                ? { ...note, checked: undefined }
                : { ...note, checked: true },
            ).catch(() => setSaveErr(true));
          }}
          onWriteNew={() => {
            setEditing(true);
            reportDirty(true, text, images);
          }}
        />
        {/* 勾选写盘失败只读态也可见:静默失败会让用户以为已摘除,次日聚合照挂。 */}
        {saveErr && <div className="dj-nc-pasteerr">{t("保存失败,请重试")}</div>}
      </>
    );
  }

  const save = async () => {
    if (saving) return; /* 在途:连按不重入写链(C6) */
    const trimmed = text.trim();
    const next: DayNote | null =
      trimmed || images.length
        ? {
            text: trimmed,
            images,
            updatedAt: Date.now(),
            ...(note?.checked ? { checked: true } : {}),
          }
        : null;
    setSaveErr(false);
    setSaving(true);
    try {
      await saveNote(y, m, d, next);
      setEditing(false);
      reportDirty(false, trimmed, images);
    } catch {
      setSaveErr(true); /* 写盘失败保持编辑态,内容不丢 */
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    const [t0, i0] = enterEdit(note);
    setText(t0);
    setImages(i0);
    setEditing(false);
    setAskDiscard(false); /* 归位:残留 true 会在重进编辑态时弹幻影弃稿确认 */
    reportDirty(false, t0, i0);
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...(e.clipboardData?.items ?? [])].find((it) =>
      it.type.startsWith("image/"),
    );
    if (!item) return;
    e.preventDefault();
    const blob = item.getAsFile();
    if (!blob) return;
    void savePastedImage(y, m, d, blob, blob.name).then((img) => {
      if (img) {
        setPasteErr(false); /* 贴图成功即清旧错(L17):错误提示不常驻 */
        const next = [...images, img];
        setImages(next);
        reportDirty(true, text, next);
      } else setPasteErr(true);
    });
  };

  return (
    <div className="dj-notecard">
      <DraftMirrorBar mirror={mirrorBar} onRestore={restoreMirrorBar} onDiscard={() => draftMirrorClear(noteMirrorSlot(y, m, d))} />
      <div className="dj-nc-head">
        <PencilSimpleLine size="0.75rem" /> {t("我的便签")}
      </div>
      <div className="dj-nc-editbox">
        <textarea
          ref={taRef}
          className="dj-nc-edit"
          value={text}
          placeholder={t("写点什么… ⌘/Ctrl+回车保存,Esc 取消,⌘V 可贴截图")}
          onChange={(e) => {
            setText(e.target.value);
            reportDirty(true, e.target.value, images);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing)
              return; /* IME 组词期放行(仓内纪律):Esc 消候选不撤销编辑器 */
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
            /* Esc 弃稿:无未保存内容直接收;脏稿先弹确认(误按最高频的丢稿源)。 */
            if (e.key === "Escape" && !askDiscard) {
              if (!dirty) cancel();
              else setAskDiscard(true);
            }
          }}
          onPaste={onPaste}
        />
        {pasteErr && (
          <div className="dj-nc-pasteerr">{t("图片保存失败,请重试")}</div>
        )}
        {saveErr && (
          <div className="dj-nc-pasteerr">{t("保存失败,请重试")}</div>
        )}
        {images.length > 0 && (
          <div className="dj-nc-imgs">
            {images.map((img, i) => (
              <NoteImage
                key={img.file}
                img={img}
                editing
                onDelete={() => {
                  const next = images.filter((_, j) => j !== i);
                  setImages(next);
                  reportDirty(true, text, next);
                }}
              />
            ))}
          </div>
        )}
        <div className="dj-nc-foot">
          <span>{t("与 AI 文章独立落盘 · 重新生成不碰便签")}</span>
          <div className="dj-nc-acts">
            <button type="button" className="dj-btn" onClick={cancel} disabled={saving}>
              {t("取消")}
            </button>
            <button
              type="button"
              className="dj-btn dj-btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? t("保存中…") : t("保存 ⌘↵")}
            </button>
          </div>
        </div>
      </div>
      {askDiscard && (
        <ConfirmDialog
          title={t("丢弃修改")}
          message={t("便签有未保存修改,丢弃?")}
          confirmLabel={t("丢弃")}
          danger
          onConfirm={cancel}
          onClose={() => setAskDiscard(false)}
        />
      )}
    </div>
  );
}
