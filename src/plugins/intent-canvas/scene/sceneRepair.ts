/**
 * 意图画布 · 场景引擎(mossx utils/scene.ts 966 行按职责拆分,移植)。
 * 本文件:种子图形与元素工厂;graph:语义图投影;repair:生成元素修复;state:sanitize/初始场景/AI 上下文。
  * 本文件:生成元素修复(颜色/绑定 id 重映射/文本位置)。
 */
import {
  isGeneratedEdgeElement,
  isGeneratedEdgeLabelElement,
  isGeneratedElementId,
  isGeneratedNodeElement,
  isGeneratedNodeTextElement,
  stableSeedHash,
} from "./sceneElements";
import { isRecord } from "../utils/json";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const GENERATED_LEGACY_COLOR_REPLACEMENTS: Record<string, string> = {
  "#000": "#334155",
  "#000000": "#334155",
  "#0f172a": "#2563eb",
  "#111827": "#f8fafc",
  "#221a08": "#fff7ed",
  "#05252c": "#ecfeff",
  "#0b1d34": "#eff6ff",
  "#08261d": "#ecfdf5",
  "#082f2c": "#f0fdfa",
  "#1a2607": "#f7fee7",
  "#2b1d05": "#fffbeb",
  "#fef3c7": "#92400e",
  "#a5f3fc": "#0e7490",
  "#bfdbfe": "#1d4ed8",
  "#bbf7d0": "#047857",
  "#ccfbf1": "#0f766e",
  "#ecfccb": "#4d7c0f",
  "#e2e8f0": "#334155",
};


function repairGeneratedColor(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return GENERATED_LEGACY_COLOR_REPLACEMENTS[value.toLowerCase()] ?? value;
}

function getRecordNumber(value: Record<string, unknown>, key: string): number | null {
  const rawValue = value[key];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function getGeneratedElementText(value: Record<string, unknown> | null | undefined): string {
  const text = typeof value?.text === "string" ? value.text : "";
  const originalText = typeof value?.originalText === "string" ? value.originalText : "";
  return (text || originalText).trim();
}

function getBoundElementIds(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.boundElements)) {
    return [];
  }
  return value.boundElements.flatMap((element) => (
    isRecord(element) && typeof element.id === "string" ? [element.id] : []
  ));
}

function remapBindingElementId(value: unknown, idByOriginalId: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const elementId = typeof value.elementId === "string"
    ? idByOriginalId.get(value.elementId) ?? value.elementId
    : value.elementId;
  return {
    ...value,
    elementId,
  };
}

function remapBoundElements(value: unknown, idByOriginalId: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((element) => {
    if (!isRecord(element)) {
      return element;
    }
    const id = typeof element.id === "string"
      ? idByOriginalId.get(element.id) ?? element.id
      : element.id;
    return {
      ...element,
      id,
    };
  });
}

function findGeneratedNodeTextIndex(input: {
  records: Record<string, unknown>[];
  nodeIndex: number;
  pairedTextIndexes: ReadonlySet<number>;
}): number | null {
  const node = input.records[input.nodeIndex];
  if (!node) {
    return null;
  }
  const boundTextIndex = getBoundElementIds(node)
    .map((id) => input.records.findIndex((record, index) => (
      index !== input.nodeIndex
      && !input.pairedTextIndexes.has(index)
      && record.id === id
      && isGeneratedNodeTextElement(record)
    )))
    .find((index) => index >= 0);
  if (boundTextIndex !== undefined) {
    return boundTextIndex;
  }
  const nodeId = typeof node.id === "string" ? node.id : "";
  const containerTextIndex = input.records.findIndex((record, index) => (
    index !== input.nodeIndex
    && !input.pairedTextIndexes.has(index)
    && isGeneratedNodeTextElement(record)
    && record.containerId === nodeId
  ));
  if (containerTextIndex >= 0) {
    return containerTextIndex;
  }
  const nextRecord = input.records[input.nodeIndex + 1];
  if (
    nextRecord
    && !input.pairedTextIndexes.has(input.nodeIndex + 1)
    && isGeneratedNodeTextElement(nextRecord)
  ) {
    return input.nodeIndex + 1;
  }
  const nodeX = getRecordNumber(node, "x");
  const nodeY = getRecordNumber(node, "y");
  if (nodeX === null || nodeY === null) {
    return null;
  }
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  input.records.forEach((record, index) => {
    if (index === input.nodeIndex || input.pairedTextIndexes.has(index) || !isGeneratedNodeTextElement(record)) {
      return;
    }
    const textX = getRecordNumber(record, "x");
    const textY = getRecordNumber(record, "y");
    if (textX === null || textY === null) {
      return;
    }
    const distance = Math.abs(textX - nodeX) + Math.abs(textY - nodeY);
    if (distance < closestDistance && distance <= 96) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function repairGeneratedNodeTextPosition(input: {
  node: Record<string, unknown>;
  text: Record<string, unknown>;
}): void {
  const nodeX = getRecordNumber(input.node, "x");
  const nodeY = getRecordNumber(input.node, "y");
  const nodeWidth = getRecordNumber(input.node, "width");
  const nodeHeight = getRecordNumber(input.node, "height");
  if (nodeX !== null) {
    input.text.x = nodeX + 14;
  }
  if (nodeY !== null) {
    input.text.y = nodeY + 16;
  }
  if (nodeWidth !== null) {
    input.text.width = Math.max(40, nodeWidth - 28);
  }
  if (nodeHeight !== null) {
    input.text.height = Math.max(24, nodeHeight - 28);
  }
}

export function repairIntentCanvasGeneratedElements(
  elements: readonly OrderedExcalidrawElement[],
): OrderedExcalidrawElement[] {
  const usedIds = new Set<string>();
  const idByOriginalId = new Map<string, string>();
  const records = elements.map((element, index) => {
    const record = { ...(element as unknown as Record<string, unknown>) };
    const originalId = typeof record.id === "string" ? record.id : "";
    if (isGeneratedElementId(originalId)) {
      let nextId = originalId;
      if (usedIds.has(nextId)) {
        const suffix = stableSeedHash(`${originalId}:${index}`);
        nextId = `${originalId}-repair-${suffix}`;
        let attempt = 1;
        while (usedIds.has(nextId)) {
          attempt += 1;
          nextId = `${originalId}-repair-${suffix}-${attempt}`;
        }
      }
      record.id = nextId;
      if (!idByOriginalId.has(originalId)) {
        idByOriginalId.set(originalId, nextId);
      }
    }
    if (typeof record.id === "string") {
      usedIds.add(record.id);
    }
    return record;
  });

  records.forEach((record) => {
    if (!isGeneratedElementId(record.id)) {
      return;
    }
    record.strokeColor = repairGeneratedColor(record.strokeColor);
    record.backgroundColor = repairGeneratedColor(record.backgroundColor);
    record.containerId = typeof record.containerId === "string"
      ? idByOriginalId.get(record.containerId) ?? record.containerId
      : record.containerId;
    record.startBinding = remapBindingElementId(record.startBinding, idByOriginalId);
    record.endBinding = remapBindingElementId(record.endBinding, idByOriginalId);
    record.boundElements = remapBoundElements(record.boundElements, idByOriginalId);
  });

  const pairedTextIndexes = new Set<number>();
  const droppedNodeIds = new Set<string>();
  const droppedIndexes = new Set<number>();
  records.forEach((node, nodeIndex) => {
    if (!isGeneratedNodeElement(node)) {
      return;
    }
    const textIndex = findGeneratedNodeTextIndex({ records, nodeIndex, pairedTextIndexes });
    const text = textIndex === null ? null : records[textIndex];
    if (textIndex === null || !text || !getGeneratedElementText(text)) {
      if (typeof node.id === "string") {
        droppedNodeIds.add(node.id);
      }
      droppedIndexes.add(nodeIndex);
      return;
    }
    pairedTextIndexes.add(textIndex);
    text.containerId = node.id;
    text.strokeColor = repairGeneratedColor(text.strokeColor);
    repairGeneratedNodeTextPosition({ node, text });
    const existingArrowBindings = Array.isArray(node.boundElements)
      ? node.boundElements.filter((binding) => (
          isRecord(binding)
          && typeof binding.id === "string"
          && binding.type !== "text"
        ))
      : [];
    node.boundElements = [
      { id: text.id, type: "text" },
      ...existingArrowBindings,
    ];
  });

  const droppedEdgeIds = new Set<string>();
  records.forEach((record, index) => {
    if (!isGeneratedEdgeElement(record)) {
      return;
    }
    const startBinding = isRecord(record.startBinding) ? record.startBinding : null;
    const endBinding = isRecord(record.endBinding) ? record.endBinding : null;
    const startElementId = typeof startBinding?.elementId === "string" ? startBinding.elementId : null;
    const endElementId = typeof endBinding?.elementId === "string" ? endBinding.elementId : null;
    if (
      (startElementId && droppedNodeIds.has(startElementId))
      || (endElementId && droppedNodeIds.has(endElementId))
    ) {
      if (typeof record.id === "string") {
        droppedEdgeIds.add(record.id);
      }
      droppedIndexes.add(index);
    }
  });

  records.forEach((record, index) => {
    if (!isGeneratedEdgeLabelElement(record)) {
      return;
    }
    const containerId = typeof record.containerId === "string" ? record.containerId : null;
    if (containerId && droppedEdgeIds.has(containerId)) {
      droppedIndexes.add(index);
    }
  });

  return records
    .filter((_, index) => !droppedIndexes.has(index))
    .map((record) => record as unknown as OrderedExcalidrawElement);
}


