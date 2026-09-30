/**
 * 意图画布 · 场景引擎(mossx utils/scene.ts 966 行按职责拆分,移植)。
 * 本文件:种子图形与元素工厂;graph:语义图投影;repair:生成元素修复;state:sanitize/初始场景/AI 上下文。
  * 本文件:种子图形定义、id/hash、元素工厂与守卫。
 */
import { isRecord } from "../utils/json";
import { fnv1a32 } from "@kernel/textHash";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type SeedShape = {
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow";
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor?: string;
  text?: string;
  fontSize?: number;
  containerId?: string | null;
  boundElementIds?: string[];
  startBindingId?: string | null;
  endBindingId?: string | null;
  strokeWidth?: number;
  roughness?: number;
};


export const GENERATED_ELEMENT_ID_PREFIXES = [
  "intent-node-",
  "intent-node-text-",
  "intent-edge-",
  "intent-edge-label-",
  "intent-ai-draw-",
];
export function inferBoundElementType(id: string): "text" | "arrow" {
  return id.startsWith("intent-node-text-") ||
    id.startsWith("intent-edge-label-") ||
    id.startsWith("intent-ai-draw-text-")
    ? "text"
    : "arrow";
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

export function readElementLabel(element: Record<string, unknown>): string | null {
  const candidates = [element.text, element.originalText, element.label];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}


export function stableSeedHash(value: string): string {
  return fnv1a32(value).toString(36).padStart(7, "0").slice(0, 7);
}

export function createSeedShapeId(prefix: string, value: string): string {
  const safeValue = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `intent-${prefix}-${safeValue || "node"}-${stableSeedHash(value)}`;
}

export function compactCanvasLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 44 ? `${normalized.slice(0, 41)}...` : normalized;
}

function createElementId(index: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `intent-seed-${Date.now().toString(36)}-${index}`;
}

export function createSeedElement(shape: SeedShape, index: number): OrderedExcalidrawElement {
  const baseElement = {
    id: shape.id ?? createElementId(index),
    type: shape.type,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    angle: 0,
    strokeColor: shape.strokeColor,
    backgroundColor: shape.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: shape.strokeWidth ?? 2,
    strokeStyle: "solid",
    roughness: shape.roughness ?? 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: shape.type === "rectangle" ? { type: 3 } : null,
    seed: index + 1,
    version: 1,
    versionNonce: index + 100,
    isDeleted: false,
    boundElements: shape.boundElementIds?.length
      ? shape.boundElementIds.map((id) => ({
          id,
          type: inferBoundElementType(id),
        }))
      : null,
    updated: Date.now(),
    link: null,
    locked: false,
  };

  if (shape.type === "text") {
    return {
      ...baseElement,
      text: shape.text ?? "",
      originalText: shape.text ?? "",
      fontSize: shape.fontSize ?? 18,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      baseline: shape.fontSize ?? 18,
      containerId: shape.containerId ?? null,
      lineHeight: 1.25,
    } as unknown as OrderedExcalidrawElement;
  }

  if (shape.type === "arrow") {
    return {
      ...baseElement,
      points: [
        [0, 0],
        [shape.width, shape.height],
      ],
      startBinding: shape.startBindingId
        ? {
            elementId: shape.startBindingId,
            focus: 0,
            gap: 6,
          }
        : null,
      endBinding: shape.endBindingId
        ? {
            elementId: shape.endBindingId,
            focus: 0,
            gap: 6,
          }
        : null,
      startArrowhead: null,
      endArrowhead: "arrow",
      lastCommittedPoint: null,
      elbowed: false,
    } as unknown as OrderedExcalidrawElement;
  }

  return baseElement as unknown as OrderedExcalidrawElement;
}

export function isIntentCanvasElement(value: unknown): value is OrderedExcalidrawElement {
  return isRecord(value) && typeof value.id === "string" && typeof value.type === "string";
}

export function isGeneratedElementId(value: unknown): value is string {
  return typeof value === "string" && GENERATED_ELEMENT_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function isGeneratedNodeElement(value: Record<string, unknown>): boolean {
  return value.type === "rectangle" && typeof value.id === "string" && value.id.startsWith("intent-node-");
}

export function isGeneratedNodeTextElement(value: Record<string, unknown>): boolean {
  return value.type === "text" && typeof value.id === "string" && value.id.startsWith("intent-node-text-");
}

export function isGeneratedEdgeElement(value: Record<string, unknown>): boolean {
  return value.type === "arrow" && typeof value.id === "string" && value.id.startsWith("intent-edge-");
}

export function isGeneratedEdgeLabelElement(value: Record<string, unknown>): boolean {
  return value.type === "text" && typeof value.id === "string" && value.id.startsWith("intent-edge-label-");
}

