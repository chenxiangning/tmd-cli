/**
 * AttachmentStrip —— 附件条组件,显示已拖入/粘贴的文件卡片。
 *
 * 行为:
 * - 渲染附件卡(缩略图/类型图标/名字/大小)
 * - × 单删:移除附件 + 移除 textarea 里对应 token
 * - 卡片间拖拽重排(原生 HTML5 DnD)
 * - 点击图片放大预览(emit 事件给 composer 处理)
 * - 默认隐藏,无附件时不渲染
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { t } from "@kernel/i18n";
import { formatBytes, getAttachments, removeAttachmentById, reorderAttachment, subscribeAttachments, type Attachment } from "../state/attachments";

interface Props {
  /** 附件被移除时回调,composer 用于同步移除 textarea 里对应 token */
  onRemove: (a: Attachment) => void;
  /** 图片附件点击预览,composer 弹遮罩 */
  onPreviewImage: (a: Attachment) => void;
}

/* 附件卡拖拽/悬停高亮(不捕获组件响应值,提模块级纯函数) */
function handleDragStart(e: React.DragEvent<HTMLDivElement>, id: string): void {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", id);
  (e.currentTarget as HTMLElement).classList.add("tmd-attach-dragging");
}
function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
  e.preventDefault();
  (e.currentTarget as HTMLElement).classList.add("tmd-attach-drop-target");
}
function handleDragLeave(e: React.DragEvent<HTMLDivElement>): void {
  (e.currentTarget as HTMLElement).classList.remove("tmd-attach-drop-target");
}
function handleDrop(e: React.DragEvent<HTMLDivElement>, toId: string): void {
  e.preventDefault();
  (e.currentTarget as HTMLElement).classList.remove("tmd-attach-drop-target");
  const fromId = e.dataTransfer.getData("text/plain");
  if (!fromId || fromId === toId) return;
  const list = getAttachments();
  const toIdx = list.findIndex((a) => a.id === toId);
  if (toIdx >= 0) reorderAttachment(fromId, toIdx);
}
export function AttachmentStrip({ onRemove, onPreviewImage }: Props): ReactElement | null {
  const [, setTick] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  /* 订阅附件变化 */
  useEffect(() => {
    return subscribeAttachments(() => setTick((t) => t + 1));
  }, []);

  const items = getAttachments();
  if (items.length === 0) return null;

  function handleRemove(id: string): void {
    const a = items.find((x) => x.id === id);
    if (a) onRemove(a);
    removeAttachmentById(id);
  }

  function handlePreview(a: Attachment): void {
    if (a.kind === "image" && (a.previewDataUrl || a.thumbDataUrl)) {
      onPreviewImage(a);
    }
  }

  function handleDragEnd(e: React.DragEvent<HTMLDivElement>): void {
    (e.currentTarget as HTMLElement).classList.remove("tmd-attach-dragging");
    stripRef.current?.querySelectorAll(".tmd-attach-drop-target").forEach((n) => n.classList.remove("tmd-attach-drop-target"));
  }

  return (
      <div className="tmd-attach-section" role="region" aria-label={t("附件")}>
      <div className="tmd-attach-strip" ref={stripRef}>
        {items.map((a) => (
          <div
            key={a.id}
            role="button"
            tabIndex={0}
            className={`tmd-attach tmd-attach-${a.kind}`}
            title={a.path}
            draggable
            onDragStart={(e) => handleDragStart(e, a.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, a.id)}
            onClick={() => handlePreview(a)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handlePreview(a);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " ") {
                e.preventDefault();
                handlePreview(a);
              }
            }}
          >
            {a.kind === "image" && a.thumbDataUrl ? (
              <div className="tmd-attach-thumb" style={{ backgroundImage: `url("${a.thumbDataUrl}")` }} />
            ) : (
              <div className="tmd-attach-thumb tmd-attach-icon">
                <span className={`tmd-kind-icon tmd-kind-${a.kind}`}>{badgeText(a.kind)}</span>
              </div>
            )}
            <div className="tmd-attach-meta">
              <div className="tmd-attach-info">{formatBytes(a.size)}</div>
            </div>
            <span
              role="button"
              tabIndex={0}
              className="tmd-attach-close"
              title={t("移除")}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleRemove(a.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  handleRemove(a.id);
                }
              }}
            >
              ×
            </span>
          </div>
        ))}
      </div>
      <div className="tmd-attach-header">
        <span>
          {t("已附加 {n} 个文件 · 拖拽可重排", { n: items.length })}
        </span>
        <button
          type="button"
          className="tmd-attach-clear"
          onClick={() => {
            items.forEach((a) => onRemove(a));
            /* store clear 由调用方处理 */
          }}
        >
          {t("全部清除 ×")}
        </button>
      </div>
    </div>
  );
}

function badgeText(kind: Attachment["kind"]): string {
  switch (kind) {
    case "image": return "IMG";
    case "pdf":   return "PDF";
    case "code":  return "{ }";
    default:      return "FILE";
  }
}
