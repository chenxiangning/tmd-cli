/**
 * 意图画布 · 磁盘 JSON 防御式归一化(mossx intentCanvasStorage 拆分,移植)。
 * 本文件:语义图/节点/边/证据/AI 标注归一化。
 */
import type {
  CanvasAiAnnotation,
  CanvasEvidenceRef,
  CanvasSemanticGraph,
  CanvasSourceAnchor,
} from "../types";
import { asString, asStringArray, isRecord } from "../utils/json";
import { asBoolean, normalizeFiniteNumber, normalizePathValue } from "./codecShared";
import {
  normalizeCanvasSourceAnchor,
  normalizeIntentCanvasCodeSelectionAnchor,
} from "./anchorCodec";

export function normalizeCanvasSemanticGraph(value: unknown): CanvasSemanticGraph | null {
  if (!isRecord(value)) {
    return null;
  }
  const graphId = asString(value.graphId);
  const createdAt = asString(value.createdAt);
  if (!graphId || !createdAt) {
    return null;
  }
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((node) => {
      const normalized = normalizeCanvasSemanticNode(node);
      return normalized ? [normalized] : [];
    })
    : [];
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((edge) => {
      const normalized = normalizeCanvasSemanticEdge(edge);
      return normalized ? [normalized] : [];
    })
    : [];
  const sourceSnapshot = isRecord(value.sourceSnapshot) && value.sourceSnapshot.kind === "project-map-relations"
    ? {
        kind: "project-map-relations" as const,
        scanRunId: asString(value.sourceSnapshot.scanRunId),
        snapshotVersion: asString(value.sourceSnapshot.snapshotVersion),
      }
    : null;

  const importOptions = isRecord(value.importOptions)
    ? {
        depth: normalizeFiniteNumber(value.importOptions.depth, 0),
        direction: asString(value.importOptions.direction) as
          | "callers"
          | "callees"
          | "both"
          | "neighborhood"
          | undefined,
        centerNodeId: asString(value.importOptions.centerNodeId),
        maxNodes: normalizeFiniteNumber(value.importOptions.maxNodes, 0),
        maxEdges: normalizeFiniteNumber(value.importOptions.maxEdges, 0),
        omittedNodes: normalizeFiniteNumber(value.importOptions.omittedNodes, 0),
        omittedEdges: normalizeFiniteNumber(value.importOptions.omittedEdges, 0),
      }
    : undefined;

  return {
    graphId,
    createdAt,
    sourceSnapshot: sourceSnapshot && sourceSnapshot.scanRunId ? {
      kind: sourceSnapshot.kind,
      scanRunId: sourceSnapshot.scanRunId,
      snapshotVersion: sourceSnapshot.snapshotVersion,
    } : undefined,
    sourceSelection: normalizeIntentCanvasCodeSelectionAnchor(value.sourceSelection) ?? undefined,
    nodes,
    edges,
    importOptions,
  };
}

export function normalizeCanvasSemanticNode(value: unknown): {
  id: string;
  label: string;
  kind: "file" | "symbol" | "module" | "group" | "endpoint" | "unknown";
  sourceAnchor?: CanvasSourceAnchor | null;
  evidenceIds?: string[];
  summary?: string | null;
  stale?: boolean;
  unresolved?: boolean;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const rawLabel = asString(value.label);
  const rawKind = asString(value.kind);
  if (!id || !rawLabel) {
    return null;
  }
  const kind =
    rawKind === "file" || rawKind === "symbol" || rawKind === "module" || rawKind === "group" || rawKind === "endpoint"
      ? rawKind
      : "unknown";
  return {
    id,
    label: rawLabel,
    kind,
    sourceAnchor: isRecord(value.sourceAnchor) ? normalizeCanvasSourceAnchor(value.sourceAnchor) : undefined,
    evidenceIds: asStringArray(value.evidenceIds),
    summary: asString(value.summary),
    stale: asBoolean(value.stale) ?? false,
    unresolved: asBoolean(value.unresolved) ?? false,
  };
}

export function normalizeCanvasEvidenceRef(value: unknown): CanvasEvidenceRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    path: normalizePathValue(value.path),
    line: normalizeFiniteNumber(value.line, 1),
    excerpt: asString(value.excerpt),
    label: asString(value.label),
  };
}

export function normalizeCanvasSemanticEdge(value: unknown): {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationKind: string;
  direction?: "out" | "in" | "both" | "undirected";
  sourceAnchor?: CanvasSourceAnchor | null;
  label?: string | null;
  evidenceIds?: string[];
  evidenceRefs?: CanvasEvidenceRef[];
  evidenceSummary?: string[];
  stale?: boolean;
  unresolved?: boolean;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const sourceNodeId = asString(value.sourceNodeId);
  const targetNodeId = asString(value.targetNodeId);
  const relationKind = asString(value.relationKind);
  if (!id || !sourceNodeId || !targetNodeId || !relationKind) {
    return null;
  }
  const direction = asString(value.direction);
  return {
    id,
    sourceNodeId,
    targetNodeId,
    relationKind,
    direction:
      direction === "out" || direction === "in" || direction === "both" || direction === "undirected"
        ? direction
        : undefined,
    sourceAnchor: isRecord(value.sourceAnchor) ? normalizeCanvasSourceAnchor(value.sourceAnchor) : undefined,
    label: asString(value.label),
    evidenceIds: asStringArray(value.evidenceIds),
    evidenceRefs: Array.isArray(value.evidenceRefs)
      ? value.evidenceRefs.flatMap((entry) => {
          const normalized = normalizeCanvasEvidenceRef(entry);
          return normalized ? [normalized] : [];
        })
      : undefined,
    evidenceSummary: asStringArray(value.evidenceSummary),
    stale: asBoolean(value.stale) ?? false,
    unresolved: asBoolean(value.unresolved) ?? false,
  };
}

export function normalizeCanvasAiAnnotation(value: unknown): CanvasAiAnnotation | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const targetGraphId = asString(value.targetGraphId);
  const content = asString(value.content);
  const createdAt = asString(value.createdAt);
  const annotationKind = asString(value.annotationKind);
  if (!id || !targetGraphId || !content || !createdAt || !annotationKind) {
    return null;
  }
  return {
    id,
    targetGraphId,
    targetNodeIds: asStringArray(value.targetNodeIds),
    targetEdgeIds: asStringArray(value.targetEdgeIds),
    annotationKind,
    content,
    createdAt,
  };
}

export function normalizeCanvasSemanticGraphs(value: unknown): CanvasSemanticGraph[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((graph) => {
    const normalized = normalizeCanvasSemanticGraph(graph);
    return normalized ? [normalized] : [];
  });
}

export function normalizeCanvasAiAnnotations(value: unknown): CanvasAiAnnotation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const normalized = normalizeCanvasAiAnnotation(item);
    return normalized ? [normalized] : [];
  });
}
