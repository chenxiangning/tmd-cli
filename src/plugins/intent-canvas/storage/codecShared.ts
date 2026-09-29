/**
 * 意图画布 · 磁盘 JSON 防御式归一化(mossx intentCanvasStorage 拆分,移植)。
 * 本文件:标量/路径/计数等基础归一化原语,anchor/graph/document 三 codec 共用。
 */
import { asString } from "../utils/json";
export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function normalizeFiniteNumber(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized >= minimum ? normalized : null;
}

export function normalizePathValue(value: unknown): string | null {
  const path = asString(value);
  if (!path) {
    return null;
  }
  return path.replace(/\\/g, "/");
}


export function normalizePositiveLineNumber(value: unknown): number | null {
  const line = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(line) && line >= 1 ? line : null;
}


export function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
