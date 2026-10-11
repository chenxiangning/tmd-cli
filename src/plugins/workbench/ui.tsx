/**
 * 工作台 · 基础 UI 件:徽标、进度条、确认弹窗、空态提示、附件行。
 * 弹窗走 kernel/DialogShell(原生 dialog + 点背板/Esc 收口,与 git 弹层族同骨架);
 * 语气色映射在 tone.ts(only-export-components 拆分)。
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { t } from "@kernel/i18n";
import { FileImage, Paperclip, X } from "@phosphor-icons/react";
import { toneVar } from "./tone";
import { bytes } from "./kindLabels";
import { isImageAttachment } from "./workbenchFiles";
import { runIpc } from "./ipcToast";
import type { Attachment } from "./types";

export function WbBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="wb-badge" style={{ color: toneVar(tone), borderColor: toneVar(tone) }}>
      {children}
    </span>
  );
}

export function WbProgress({ value, tone }: { value: number; tone?: string }) {
  return (
    <span className="wb-progress" title={`${value}%`}>
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: tone ? toneVar(tone) : "var(--tmd-accent)" }} />
    </span>
  );
}

export function WbEmpty({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="wb-empty">
      <p>{text}</p>
      {children}
    </div>
  );
}

/** 附件/图片放大预览(点遮罩或 Esc 关闭;capture 拦 Esc 防穿透关掉底层弹层)。 */
export function WbImgView({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div role="presentation" className="wb-imgview-backdrop" onClick={onClose}>
      <dialog open aria-label={name} className="wb-imgview" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={name} />
        <p>{name}</p>
      </dialog>
    </div>
  );
}

/** 轻确认弹窗(DialogShell 骨架;确认语义由调用方文案表达)。 */
export function WbConfirm({
  open, title, body, confirmLabel, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <DialogShell
      title={title}
      icon={null}
      width={440}
      onClose={onCancel}
      footer={<DialogActions confirmLabel={confirmLabel} onConfirm={onConfirm} onCancel={onCancel} />}
    >
      {body ? <div className="wb-modal-body">{body}</div> : null}
    </DialogShell>
  );
}

/** 附件区(文档编辑器与任务详情逐字重复收敛至此):标题计数 + 上传钮 +
 *  隐藏 file input + 附件行列表;上传实现与打开/删除动作由调用方注入。 */
export function WbAttachmentSection({ items, onUpload, onOpen, onDelete, onToast }: {
  items: Attachment[];
  onUpload: (file: File) => void;
  onOpen: (att: Attachment) => void;
  onDelete: (att: Attachment) => Promise<unknown>;
  onToast: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="wb-taskdetail-sec">
      <h4>{t("附件")}<span className="wb-panel-sub">{items.length}</span></h4>
      <div className="wb-taskdetail-actions">
        <button type="button" className="wb-btn" onClick={() => fileRef.current?.click()}>
          <Paperclip size={12} />{t("上传附件/图片")}
        </button>
        <input
          ref={fileRef} type="file" hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
      <ul className="wb-attach-list">
        {items.map((att) => (
          <li key={att.id} className="wb-attach-row">
            <span className="wb-attach-ico">{isImageAttachment(att.fileName) ? <FileImage size={13} /> : <Paperclip size={13} />}</span>
            <button type="button" className="wb-link" onClick={() => onOpen(att)}>{att.name}</button>
            <span className="wb-attach-meta">{bytes(att.size)}</span>
            <button
              type="button" className="wb-btn wb-btn-xs wb-attach-del" aria-label={t("删除")}
              onClick={() => runIpc(onDelete(att), onToast, t("附件已删除"))}
            ><X size={11} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
