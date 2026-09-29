/**
 * 意图画布 · 磁盘 JSON 防御式归一化(mossx intentCanvasStorage 拆分,移植)。
 * 本文件:代码选区锚点与 source anchor(relationship/code-symbol)归一化。
 */
import type {
  CanvasCodeSymbolKind,
  CanvasSourceAnchor,
  IntentCanvasCodeSelectionAnchor,
} from "../types";
import { asString, asStringArray, isRecord } from "../utils/json";
import {
  normalizeFiniteNumber,
  normalizePathValue,
  normalizePositiveLineNumber,
} from "./codecShared";

export function normalizeCanvasSourceRange(value: unknown): { startLine: number; startColumn?: number | null; endLine?: number | null; endColumn?: number | null } | null {
  if (!isRecord(value)) {
    return null;
  }
  const startLine = normalizeFiniteNumber(value.startLine, 1);
  const startColumn = normalizeFiniteNumber(value.startColumn, 0);
  const endLine = normalizeFiniteNumber(value.endLine, 1);
  const endColumn = normalizeFiniteNumber(value.endColumn, 0);
  if (startLine === null && endLine === null) {
    return null;
  }
  return {
    startLine: startLine ?? endLine ?? 1,
    startColumn: startColumn,
    endLine: endLine ?? startLine ?? 1,
    endColumn: endColumn,
  };
}

export function normalizeIntentCanvasCodeSelectionAnchor(value: unknown): IntentCanvasCodeSelectionAnchor | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = asString(value.source);
  const filePath = asString(value.filePath);
  const startLine = normalizePositiveLineNumber(value.startLine);
  const endLine = normalizePositiveLineNumber(value.endLine);
  const declarationLine = normalizePositiveLineNumber(value.declarationLine);
  const symbolName = asString(value.symbolName);
  const symbolKind = asString(value.symbolKind);
  if (
    source !== "active-editor-selection" ||
    !filePath ||
    !startLine ||
    !endLine ||
    !declarationLine ||
    !symbolName ||
    !symbolKind
  ) {
    return null;
  }
  const normalizedStartLine = Math.min(startLine, endLine);
  const normalizedEndLine = Math.max(startLine, endLine);
  return {
    source,
    filePath,
    startLine: normalizedStartLine,
    endLine: normalizedEndLine,
    declarationLine,
    symbolName,
    symbolKind: [
      "class",
      "method",
      "function",
      "property",
      "interface",
      "enum",
      "record",
      "type",
      "struct",
      "trait",
    ].includes(symbolKind)
      ? symbolKind as IntentCanvasCodeSelectionAnchor["symbolKind"]
      : "property",
  };
}

export function normalizeCanvasSourceAnchor(value: unknown): CanvasSourceAnchor | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = asString(value.kind);
  const workspaceId = asString(value.workspaceId);
  if (!workspaceId || !kind) {
    return null;
  }
  if (kind === "code-symbol") {
    const filePath = normalizePathValue(value.filePath);
    const symbolName = asString(value.symbolName);
    const symbolKind = asString(value.symbolKind);
    if (!filePath || !symbolName) {
      return null;
    }
    const resolvedSymbolKind: CanvasCodeSymbolKind =
      symbolKind === "function" || symbolKind === "method" || symbolKind === "class" || symbolKind === "module"
        ? symbolKind
        : "unknown";
    return {
      kind,
      workspaceId,
      filePath,
      symbolName,
      symbolKind: resolvedSymbolKind,
      scanRunId: asString(value.scanRunId),
      symbolId: asString(value.symbolId),
      selectionRange: normalizeCanvasSourceRange(value.selectionRange),
      definitionRange: normalizeCanvasSourceRange(value.definitionRange),
      resolvedBy: asString(value.resolvedBy) ?? undefined,
    };
  }
  if (kind === "relationship-node") {
    const nodeId = asString(value.nodeId);
    const nodeKind = asString(value.nodeKind);
    const scanRunId = asString(value.scanRunId);
    if (!nodeId || !nodeKind || !scanRunId) {
      return null;
    }
    return {
      kind,
      workspaceId,
      scanRunId,
      nodeId,
      nodeKind,
      filePath: normalizePathValue(value.filePath),
      symbolId: asString(value.symbolId),
    };
  }
  if (kind === "relationship-edge") {
    const edgeId = asString(value.edgeId);
    const relationKind = asString(value.relationKind);
    const sourceNodeId = asString(value.sourceNodeId);
    const targetNodeId = asString(value.targetNodeId);
    const scanRunId = asString(value.scanRunId);
    if (!edgeId || !relationKind || !sourceNodeId || !targetNodeId || !scanRunId) {
      return null;
    }
    return {
      kind,
      workspaceId,
      scanRunId,
      edgeId,
      relationKind,
      sourceNodeId,
      targetNodeId,
      evidenceIds: asStringArray(value.evidenceIds),
    };
  }
  return null;
}

