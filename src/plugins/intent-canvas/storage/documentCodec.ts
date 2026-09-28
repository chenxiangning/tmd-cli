/**
 * 意图画布 · 磁盘 JSON 防御式归一化(mossx intentCanvasStorage 拆分,移植)。
 * 本文件:文档/索引条目归一化与深拷贝。
 */
import type {
  CanvasAiAnnotation,
  CanvasSemanticGraph,
  CanvasSemanticNode,
  CanvasSemanticEdge,
  CanvasSourceAnchor,
  IntentCanvasDocument,
  IntentCanvasIndexEntry,
  IntentCanvasIndexFile,
  IntentCanvasLinks,
  IntentCanvasMode,
} from "../types";
import { asString, asStringArray, isRecord } from "../utils/json";
import { createInitialIntentCanvasScene, buildIntentCanvasAiContext, sanitizeIntentCanvasScene } from "../scene/sceneState";
import { normalizeCanvasSemanticGraphs, normalizeCanvasAiAnnotations } from "./graphCodec";
import { normalizeCount } from "./codecShared";
import { normalizeCanvasId, resolveDocumentPath } from "./paths";

export function normalizeMode(value: unknown): IntentCanvasMode {
  return value === "spotlight" || value === "file" ? value : "architect";
}

export function normalizeLinks(value: unknown): IntentCanvasLinks {
  if (!isRecord(value)) {
    return { projectMapNodeIds: [], filePaths: [], threadIds: [] };
  }
  return {
    projectMapNodeIds: asStringArray(value.projectMapNodeIds),
    filePaths: asStringArray(value.filePaths),
    threadIds: asStringArray(value.threadIds),
  };
}


export function buildIndexEntry(document: IntentCanvasDocument): IntentCanvasIndexEntry {
  const safeCanvasId = normalizeCanvasId(document.id);
  if (!safeCanvasId) {
    throw new Error(`Invalid Intent Canvas id: ${document.id}`);
  }
  return {
    id: safeCanvasId,
    title: document.title,
    mode: document.mode,
    summary: document.summary,
    updatedAt: document.updatedAt,
    createdAt: document.createdAt,
    path: resolveDocumentPath(safeCanvasId),
    linkedFileCount: document.links.filePaths.length,
    linkedProjectMapNodeCount: document.links.projectMapNodeIds.length,
    linkedThreadCount: document.links.threadIds.length,
    elementCount: document.scene.elements.filter((element) => !element.isDeleted).length,
  };
}


export function normalizeIndexEntry(value: unknown): IntentCanvasIndexEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeCanvasId(value.id);
  const title = asString(value.title);
  const updatedAt = asString(value.updatedAt);
  const createdAt = asString(value.createdAt) ?? updatedAt;
  if (!id || !title || !updatedAt || !createdAt) {
    return null;
  }
  return {
    id,
    title,
    path: resolveDocumentPath(id),
    updatedAt,
    createdAt,
    mode: normalizeMode(value.mode),
    summary: asString(value.summary) ?? "",
    linkedFileCount: normalizeCount(value.linkedFileCount),
    linkedProjectMapNodeCount: normalizeCount(value.linkedProjectMapNodeCount),
    linkedThreadCount: normalizeCount(value.linkedThreadCount),
    elementCount: normalizeCount(value.elementCount),
    thumbnailSvg: asString(value.thumbnailSvg) ?? undefined,
  };
}

export function normalizeIndexFile(value: unknown): IntentCanvasIndexFile {
  if (!isRecord(value) || !Array.isArray(value.canvases)) {
    return { version: 1, canvases: [] };
  }
  return {
    version: 1,
    canvases: value.canvases.flatMap((entry) => {
      const normalized = normalizeIndexEntry(entry);
      return normalized ? [normalized] : [];
    }),
  };
}

export function normalizeIntentCanvasDocument(value: unknown): IntentCanvasDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeCanvasId(value.id);
  const title = asString(value.title);
  const createdAt = asString(value.createdAt);
  const updatedAt = asString(value.updatedAt);
  const workspace = isRecord(value.workspace) ? value.workspace : null;
  const workspaceId = asString(workspace?.id);
  if (!id || !title || !createdAt || !updatedAt || !workspaceId || value.kind !== "intent-canvas") {
    return null;
  }
  const links = normalizeLinks(value.links);
  const scene = isRecord(value.scene)
    ? sanitizeIntentCanvasScene(
        Array.isArray(value.scene.elements) ? value.scene.elements : [],
        isRecord(value.scene.appState) ? value.scene.appState : {},
        isRecord(value.scene.files) ? value.scene.files : {},
      )
    : createInitialIntentCanvasScene(null);
  const summary = asString(value.summary) ?? "";
  const semanticGraphs = normalizeCanvasSemanticGraphs(value.semanticGraphs);
  const aiAnnotations = normalizeCanvasAiAnnotations(value.aiAnnotations);
  return {
    version: 1,
    id,
    title,
    kind: "intent-canvas",
    createdAt,
    updatedAt,
    workspace: {
      id: workspaceId,
      name: asString(workspace?.name),
    },
    mode: normalizeMode(value.mode),
    summary,
    links,
    scene,
    aiContext: buildIntentCanvasAiContext(scene, summary),
    semanticGraphs,
    aiAnnotations,
  };
}

export function cloneCanvasSourceAnchor(value: CanvasSourceAnchor): CanvasSourceAnchor {
  return {
    ...value,
  };
}

export function cloneCanvasSemanticNode(value: CanvasSemanticNode): CanvasSemanticNode {
  return {
    ...value,
    sourceAnchor: value.sourceAnchor ? cloneCanvasSourceAnchor(value.sourceAnchor) : value.sourceAnchor,
    evidenceIds: value.evidenceIds ? [...value.evidenceIds] : undefined,
  };
}

export function cloneCanvasSemanticEdge(value: CanvasSemanticEdge): CanvasSemanticEdge {
  return {
    ...value,
    sourceAnchor: value.sourceAnchor ? cloneCanvasSourceAnchor(value.sourceAnchor) : value.sourceAnchor,
    evidenceIds: value.evidenceIds ? [...value.evidenceIds] : undefined,
    evidenceRefs: value.evidenceRefs ? value.evidenceRefs.map((entry) => ({ ...entry })) : undefined,
    evidenceSummary: value.evidenceSummary ? [...value.evidenceSummary] : undefined,
  };
}

export function cloneCanvasGraph(value: CanvasSemanticGraph): CanvasSemanticGraph {
  return {
    ...value,
    sourceSelection: value.sourceSelection ? { ...value.sourceSelection } : value.sourceSelection,
    nodes: value.nodes.map(cloneCanvasSemanticNode),
    edges: value.edges.map(cloneCanvasSemanticEdge),
    importOptions: value.importOptions
      ? {
          depth: value.importOptions.depth,
          direction: value.importOptions.direction,
          centerNodeId: value.importOptions.centerNodeId,
          maxNodes: value.importOptions.maxNodes,
          maxEdges: value.importOptions.maxEdges,
          omittedNodes: value.importOptions.omittedNodes,
          omittedEdges: value.importOptions.omittedEdges,
        }
      : undefined,
  };
}

export function cloneCanvasAiAnnotation(value: CanvasAiAnnotation): CanvasAiAnnotation {
  return {
    ...value,
    targetNodeIds: value.targetNodeIds ? [...value.targetNodeIds] : undefined,
    targetEdgeIds: value.targetEdgeIds ? [...value.targetEdgeIds] : undefined,
  };
}
