/**
 * Composer 附件芯片 —— 画布关联到会话的引用(marks chips 同构):
 * 迷你缩略图(纯 digest 投影,不依赖 excalidraw)+ 标题(点击反链直达画布)
 * + 元素数 + 明显关闭钮。发送时经 sendTransform 注入结构化上下文,
 * 芯片本身只是引用,不随消息注入内容。
 */

import { t } from "@kernel/i18n";
import { X } from "@phosphor-icons/react";
import { useMemo } from "react";
import { openIntentCanvasBacklink } from "../activeDocumentBridge";
import type { IntentCanvasDocument, IntentCanvasElementDigest } from "../types";

type IntentCanvasAttachmentCardProps = {
  document: IntentCanvasDocument;
  onRemove?: (documentId: string) => void;
};

type PreviewElement = IntentCanvasElementDigest & {
  previewX: number;
  previewY: number;
  previewWidth: number;
  previewHeight: number;
};

const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 118;
const PREVIEW_PADDING = 16;
/* 芯片内缩略图显示尺寸(px,viewBox 等比缩放)。 */
const PREVIEW_DISPLAY_WIDTH = 44;
const PREVIEW_DISPLAY_HEIGHT = 22;

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildSyntheticElement(
  element: IntentCanvasElementDigest,
  index: number,
): IntentCanvasElementDigest {
  return {
    ...element,
    x: 80 + index * 112,
    y: index % 2 === 0 ? 72 : 140,
    width: element.type === "text" ? 96 : 120,
    height: element.type === "text" ? 34 : 64,
  };
}

function projectElements(elements: IntentCanvasElementDigest[]): PreviewElement[] {
  const drawableElements = elements
    .slice(0, 14)
    .map((element, index) => {
      const x = finiteNumber(element.x);
      const y = finiteNumber(element.y);
      const width = finiteNumber(element.width);
      const height = finiteNumber(element.height);
      return x !== null && y !== null && width !== null && height !== null
        ? element
        : buildSyntheticElement(element, index);
    });

  if (drawableElements.length === 0) {
    return [];
  }

  const bounds = drawableElements.reduce(
    (current, element) => {
      const x = element.x ?? 0;
      const y = element.y ?? 0;
      const width = Math.max(element.width ?? 1, 1);
      const height = Math.max(element.height ?? 1, 1);
      return {
        minX: Math.min(current.minX, x),
        minY: Math.min(current.minY, y),
        maxX: Math.max(current.maxX, x + width),
        maxY: Math.max(current.maxY, y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(
    (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / boundsWidth,
    (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / boundsHeight,
  );

  return drawableElements.map((element) => {
    const x = element.x ?? 0;
    const y = element.y ?? 0;
    const width = Math.max(element.width ?? 1, 1);
    const height = Math.max(element.height ?? 1, 1);
    return {
      ...element,
      previewX: PREVIEW_PADDING + (x - bounds.minX) * scale,
      previewY: PREVIEW_PADDING + (y - bounds.minY) * scale,
      previewWidth: Math.max(width * scale, 8),
      previewHeight: Math.max(height * scale, 8),
    };
  });
}

function renderPreviewShape(element: PreviewElement) {
  if (element.type === "arrow" || element.type === "line") {
    return (
      <line
        key={element.id}
        x1={element.previewX}
        y1={element.previewY}
        x2={element.previewX + element.previewWidth}
        y2={element.previewY + element.previewHeight}
      />
    );
  }

  if (element.type === "ellipse") {
    return (
      <ellipse
        key={element.id}
        cx={element.previewX + element.previewWidth / 2}
        cy={element.previewY + element.previewHeight / 2}
        rx={element.previewWidth / 2}
        ry={element.previewHeight / 2}
      />
    );
  }

  if (element.type === "text") {
    return (
      <rect
        key={element.id}
        x={element.previewX}
        y={element.previewY}
        width={element.previewWidth}
        height={Math.min(element.previewHeight, 16)}
        rx="4"
      />
    );
  }

  return (
    <rect
      key={element.id}
      x={element.previewX}
      y={element.previewY}
      width={element.previewWidth}
      height={element.previewHeight}
      rx="8"
    />
  );
}

export function IntentCanvasAttachmentCard({
  document,
  onRemove,
}: IntentCanvasAttachmentCardProps) {
  const previewElements = useMemo(
    () => projectElements(document.aiContext.elementDigest),
    [document.aiContext.elementDigest],
  );
  const elementCount = document.aiContext.elementDigest.length;
  return (
    <div
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--tmd-accent) bg-(--tmd-bg-panel) p-px pr-0.5 text-[0.65rem] text-(--tmd-fg)"
      title={document.summary.trim() || document.title}
    >
      <button
        type="button"
        className="inline-flex min-w-0 cursor-pointer items-center gap-1.5"
        onClick={() => openIntentCanvasBacklink(document.id)}
        aria-label={t("打开画布「{title}」", { title: document.title })}
      >
        <svg
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          className="intent-canvas-chip-preview shrink-0"
          style={{ width: PREVIEW_DISPLAY_WIDTH, height: PREVIEW_DISPLAY_HEIGHT }}
          aria-hidden
        >
          <rect className="intent-canvas-chip-preview-bg" x="1" y="1" width="238" height="116" rx="14" />
          <g className="intent-canvas-chip-preview-shape">
            {previewElements.map(renderPreviewShape)}
          </g>
        </svg>
        <span className="max-w-40 truncate">{document.title}</span>
        <span className="shrink-0 text-(--tmd-fg-muted)">{elementCount}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={t("移除画布「{title}」", { title: document.title })}
          title={t("移除画布「{title}」", { title: document.title })}
          className="inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-(--tmd-border) text-(--tmd-fg-muted) hover:border-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => onRemove(document.id)}
        >
          <X aria-hidden className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}
