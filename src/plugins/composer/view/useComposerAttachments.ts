/**
 * Composer 附件交互 hook —— 拖放/粘贴/引用 token 与 textarea 文本的同步职责,
 * 从 Composer.tsx 拆出(文件规模铁则);附件状态机本体在 state/attachments.ts。
 *
 * 契约:
 * - textarea 里 "@path " 文本被手删 → token 同步 effect 移除对应 attachment;
 * - 拖入/粘贴文件 → 写临时副本(fsWriteTemp)+ 注册 attachment + 注入 "@path " token;
 * - 文件树拖来的项目内路径 → 不写副本,直接引用原 path(kernel 内部拖拽 payload)。
 */

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { ipc } from "@kernel/ipc";
import { readDragPayload, clearDragPayload } from "@kernel/internalDrag";
import {
  addAttachment,
  classifyAttachment,
  getAttachments,
  makeImageThumb,
  removeAttachmentByPath,
  MAX_ATTACHMENTS,
  type Attachment,
} from "../state/attachments";

export const ATTACH_TOKEN_RE = /@[^\s@]+/g;

/** textarea 光标处插入文本并恢复焦点/光标(value 非受控跳变由调用方 setValue 承接)。 */
export function insertAtCursor(
  ta: HTMLTextAreaElement,
  value: string,
  setValue: Dispatch<SetStateAction<string>>,
  setCursor: (i: number) => void,
  insert: string,
): void {
  const start = ta.selectionStart ?? value.length;
  const end = ta.selectionEnd ?? value.length;
  const next = value.slice(0, start) + insert + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    ta.focus();
    const caret = start + insert.length;
    ta.setSelectionRange(caret, caret);
    setCursor(caret);
  });
}

export function useComposerAttachments(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  setValue: Dispatch<SetStateAction<string>>,
  setCursor: (i: number) => void,
  setDragOver: (v: boolean) => void,
): {
  removeTokenForAttachment: (a: Attachment) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => Promise<void>;
} {
  const insert = (tailwind: string) => {
    if (ref.current) insertAtCursor(ref.current, value, setValue, setCursor, tailwind);
  };

  /* 附件 × 移除 → textarea 移除对应 "@path" 文本。
     函数式更新:全部清除等同一批次多次调用时,每次都基于最新 value 计算 ——
     闭包 value 连续 setValue 在 React 批处理下只剩最后一个的旧 bug 不再可能 */
  function removeTokenForAttachment(a: Attachment): void {
    setValue((v) =>
      v
        .replace(ATTACH_TOKEN_RE, (m) => (m.slice(1) === a.path ? "" : m))
        /* 清理连续空白 + 前后空白 */
        .replace(/  +/g, " ")
        .replace(/^\s+|\s+$/g, ""),
    );
  }

  /* textarea 里的 "@path " 文本被删 → MutationObserver 移除 attachment
     但 textarea 是 DOM,内部只是 text node —— MutationObserver 抓不到字符删除;
     改用 keyup/input 比对 tokens 列表 */
  useEffect(() => {
    /* 每次 value 变化时,扫一遍 attachment token 是否还在 */
    const attached = getAttachments();
    if (attached.length === 0) return;
    const existing = new Set(value.match(ATTACH_TOKEN_RE)?.map((t) => t.slice(1)) ?? []);
    attached.forEach((a) => {
      if (!existing.has(a.path)) {
        removeAttachmentByPath(a.path);
      }
    });
  }, [value]);

  /* 拖入或粘贴一个文件 → 写临时文件 + 注册 attachment + textarea 注入 "@path " */
  async function addFiles(fileList: FileList | File[]): Promise<void> {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const remain = MAX_ATTACHMENTS - getAttachments().length;
    if (remain <= 0) {
      /* toast 由调用方处理 */
      return;
    }
    const accepted = files.slice(0, remain);
    /* token 聚合后单次插入:逐个 insertAtCursor 会基于同一次渲染的闭包 value
       连续 setValue,React 批处理下只剩最后一个 @path,其余附件被 token
       同步 effect 静默删除。 */
    const tokens: string[] = [];
    for (const f of accepted) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const path = await ipc.fsWriteTemp(f.name || "attachment", buf);
        const kind = classifyAttachment(f.name, f.type);
        let thumbDataUrl: string | null = null;
        let previewDataUrl: string | null = null;
        if (kind === "image") {
          const thumb = await makeImageThumb(f);
          if (thumb) {
            thumbDataUrl = thumb.thumb;
            previewDataUrl = thumb.full;
          }
        }
        const att = addAttachment({ path, name: f.name, size: f.size, kind, thumbDataUrl, previewDataUrl });
        tokens.push(`@${att.path} `);
      } catch (err) {
        /* 单文件失败不阻塞其余文件,与改造前行为对齐 */
        console.warn("composer: 附件写入失败", f.name, err);
      }
    }
    if (tokens.length > 0) insert(tokens.join(""));
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imgItem = items.find((it) => it.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    await addFiles([file]);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;

    /* 优先:文件树拖来的项目内文件/文件夹 —— 从 kernel 共享 payload 读 */
    const payload = readDragPayload();
    if (payload) {
      clearDragPayload();
      attachPathReference(payload);
      return;
    }

    /* 外部文件 → 写临时文件 + 引用 */
    const files = Array.from(dt.files);
    if (files.length === 0) return;
    await addFiles(files);
  }

  /* 把项目内路径作为引用 attachment —— 不写临时副本,直接引用原 path */
  function attachPathReference(item: { path: string; isDir: boolean; name: string }): void {
    if (getAttachments().length >= MAX_ATTACHMENTS) return;
    const kind: Attachment["kind"] = item.isDir ? "file" : classifyAttachment(item.name, "");
    const att = addAttachment({
      path: item.path,
      name: item.name,
      size: 0,
      kind,
      thumbDataUrl: null,
      previewDataUrl: null,
    });
    insert(`@${att.path} `);
  }

  return { removeTokenForAttachment, handlePaste, handleDrop };
}
