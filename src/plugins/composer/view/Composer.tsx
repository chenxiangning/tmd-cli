/**
 * Composer 视图 —— textarea + 触发器下拉 + 附件条 + 翻译 → PTY。
 *
 * 行为:
 * - Enter 发送 / Shift+Enter 换行
 * - 触发符(由当前会话 cli profile 声明)在光标前识别后,弹下拉
 *   - 候选来自:
 *     @ fsListDir(file 触发)
 *     / profile.suggestions.command
 *     $ profile.suggestions.skill
 *   - 候选面板支持 ↑↓/Enter/Tab/Esc 选中,选中替换触发器 + token
 * - 发送时把命中 "$token" → translate("/skill:token")(omp/pi 已声明)
 * - 拖入/粘贴图片 → 写临时文件 → 注册 attachment → textarea 注入 "@path "
 * - attachment × 删除 → 同步移除 textarea 里对应 "@path " 文本
 * - textarea 里删除 "@path " 文本 → MutationObserver 移除对应 attachment
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { Mounts } from "@kernel/Mounts";
import { readDragPayload, clearDragPayload } from "@kernel/internalDrag";
import { findActiveTrigger, prepareSendPayload } from "../serialize/serialize";
import type { SuggestionMatch } from "../triggers/suggest";
import { lookupSuggestions } from "../triggers/suggest";
import { SuggestionList } from "./SuggestionList";
import { useActiveProfile } from "../state/useActiveProfile";
import { AttachmentStrip } from "./AttachmentStrip";
import {
  addAttachment,
  classifyAttachment,
  clearAttachments,
  getAttachments,
  MAX_ATTACHMENTS,
  makeImageThumb,
  removeAttachmentByPath,
  type Attachment,
} from "../state/attachments";

const ATTACH_TOKEN_RE = /@[^\s@]+/g;

export function Composer() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [matches, setMatches] = useState<SuggestionMatch[] | null>(null);
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const profile = useActiveProfile();

  const triggerSpecs = useMemo(() => profile?.triggers ?? [], [profile]);

  /* 触发器下拉:光标或 profile 变化时,探查是否存在激活触发符 */
  useEffect(() => {
    if (!profile || triggerSpecs.length === 0) {
      setMatches(null);
      setActiveRange(null);
      return;
    }
    const hit = findActiveTrigger(value, cursor, triggerSpecs);
    if (!hit) {
      setMatches(null);
      setActiveRange(null);
      return;
    }
    let cancelled = false;
    void lookupSuggestions(profile, hit.spec, value.slice(hit.range[0], hit.range[1])).then(
      (ms) => {
        if (cancelled) return;
        setActiveRange(hit.range);
        setMatches(ms.length ? ms : null);
        setPickIndex(0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value, cursor, profile, triggerSpecs]);

  /* 附件 × 移除 → textarea 移除对应 "@path" 文本 */
  function removeTokenForAttachment(a: Attachment): void {
    if (!value) return;
    const next = value.replace(ATTACH_TOKEN_RE, (m) => (m.slice(1) === a.path ? "" : m));
    /* 清理连续空白 + 前后空白 */
    setValue(next.replace(/  +/g, " ").replace(/^\s+|\s+$/g, ""));
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

  function applyPick(match: SuggestionMatch) {
    const range = activeRange;
    if (!range) return;
    const charSpec = triggerSpecs.find((s) =>
      value.slice(range[0], range[0] + 1) === s.char,
    );
    const head = charSpec?.char ?? "";
    const next = value.slice(0, range[0]) + head + match.value + value.slice(range[1]);
    setValue(next);
    setMatches(null);
    setActiveRange(null);
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      const caret = range[0] + head.length + match.value.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }

  function sendCurrent() {
    if (!value.trim()) return;
    if (!profile || !host.getActiveSessionId()) return;
    const payload = prepareSendPayload(profile, value);
    void ipc.sessionWrite(host.getActiveSessionId()!, payload);
    setValue("");
    clearAttachments();
    setMatches(null);
  }

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
        insertAtCursor(ref.current!, `@${att.path} `);
      } catch (err) {
        /* 单文件失败不阻塞其余文件,与改造前行为对齐 */
        console.warn("composer: 附件写入失败", f.name, err);
      }
    }
  }

  function insertAtCursor(ta: HTMLTextAreaElement, insert: string): void {
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
    if (ref.current) insertAtCursor(ref.current, `@${att.path} `);
  }

  function handleRemoveAttachment(a: Attachment): void {
    removeTokenForAttachment(a);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="relative flex h-full flex-col bg-(--tmd-bg-base)"
    >
      <div className="relative flex h-full flex-col overflow-hidden border-t border-(--tmd-border) bg-(--tmd-bg-elevated)">
        <Mounts point="composer.statusBar" />
        <AttachmentStrip onRemove={handleRemoveAttachment} onPreviewImage={(a) => setPreviewSrc(a.previewDataUrl || a.thumbDataUrl)} />
        {matches && activeRange && (
          <SuggestionList
            matches={matches}
            pickIndex={pickIndex}
            onPick={applyPick}
            onHoverIndex={setPickIndex}
          />
        )}
        <textarea
          id="composer-textarea"
          ref={ref}
          value={value}
          placeholder="输入消息，回车发送，Shift+回车换行。可用 / 命令 / $ skill / @ 文件引用。拖入文件或 ⌘V 粘贴图片会自动插入引用。"
          className="min-h-0 flex-1 resize-none bg-transparent p-0 text-sm leading-[1.58] text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          onChange={(e) => {
            setValue(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && matches) {
              e.preventDefault();
              setPickIndex((i) => (matches.length ? (i + 1) % matches.length : 0));
              return;
            }
            if (e.key === "ArrowUp" && matches) {
              e.preventDefault();
              setPickIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
              return;
            }
            if (matches) {
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (matches[pickIndex]) applyPick(matches[pickIndex]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMatches(null);
                setActiveRange(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              sendCurrent();
            }
          }}
          onPaste={handlePaste}
        />
      </div>
      {previewSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <img src={previewSrc} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}
