/**
 * 意图画布 · 传输上下文元素级助手(自 context.ts 拆出,守行数铁则)。
 * 场景元素摘要读取与可视化元素计数,供压缩器与 digest 使用。
 */

import type { IntentCanvasDocument, IntentCanvasElementDigest } from "../types";


export function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function isDeletedSceneElement(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && "isDeleted" in value
      && (value as { isDeleted?: unknown }).isDeleted === true,
  );
}

export function getSceneElementType(value: unknown): string | null {
  return value
    && typeof value === "object"
    && typeof (value as { type?: unknown }).type === "string"
    ? (value as { type: string }).type
    : null;
}

export function readSceneElementText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rawElement = value as { text?: unknown; originalText?: unknown; label?: unknown };
  const candidates = [rawElement.text, rawElement.originalText, rawElement.label];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeText(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function hasDisplayEllipsis(value: string): boolean {
  return value.includes("...") || value.includes("…");
}

export function countVisualElements(document: IntentCanvasDocument): {
  totalElements: number;
  totalRelations: number;
  textBlocks: string[];
  displayAbbreviatedTextBlockCount: number;
  unlabeledShapeCount: number;
} {
  const textBlocks = new Set<string>();
  const displayAbbreviatedTextBlocks = new Set<string>();
  let totalElements = 0;
  let totalRelations = 0;
  let unlabeledShapeCount = 0;

  document.scene.elements.forEach((element) => {
    if (isDeletedSceneElement(element)) {
      return;
    }
    totalElements += 1;
    const type = getSceneElementType(element);
    if (type === "arrow" || type === "line") {
      totalRelations += 1;
    }
    const text = readSceneElementText(element);
    if (text) {
      if (hasDisplayEllipsis(text)) {
        displayAbbreviatedTextBlocks.add(text);
      } else {
        textBlocks.add(text);
      }
      return;
    }
    if (type && type !== "arrow" && type !== "line" && type !== "text") {
      unlabeledShapeCount += 1;
    }
  });

  return {
    totalElements,
    totalRelations,
    textBlocks: Array.from(textBlocks),
    displayAbbreviatedTextBlockCount: displayAbbreviatedTextBlocks.size,
    unlabeledShapeCount,
  };
}

export function buildElementLabelIndex(elements: IntentCanvasElementDigest[]): Map<string, string> {
  const labelsById = new Map<string, string>();
  elements.forEach((element) => {
    const label = normalizeText(element.label);
    if (label && !hasDisplayEllipsis(label)) {
      labelsById.set(element.id, label);
    }
  });
  return labelsById;
}
