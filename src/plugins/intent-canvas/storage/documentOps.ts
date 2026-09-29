/**
 * 意图画布 · 文档操作(create/append/clone,自 documents.ts 拆出,守行数铁则)。
 * append:新场景平移到现有最右边缘 +160、按 40 取整后拼接(mossx 同款)。
 */

import type {
  CanvasSemanticGraph,
  IntentCanvasDocument,
  IntentCanvasOpenRequest,
  IntentCanvasScene,
  IntentCanvasWorkspaceRef,
} from "../types";
import { t } from "@kernel/i18n";
import { buildIntentCanvasAiContext, createInitialIntentCanvasScene, sanitizeIntentCanvasScene } from "../scene/sceneState";
import type { IntentCanvasLinks } from "../types";
import { cloneCanvasGraph, cloneCanvasAiAnnotation } from "./documentCodec";
import { createCanvasId } from "./paths";

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.flatMap((value) => {
        if (typeof value !== "string") {
          return [];
        }
        const normalized = value.trim();
        return normalized ? [normalized] : [];
      }),
    ),
  );
}
function collectSeedProjectMapNodeIds(seedSemanticGraphs: CanvasSemanticGraph[]): string[] {
  const nodeIds = new Set<string>();
  seedSemanticGraphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      if (node.sourceAnchor?.kind === "relationship-node") {
        nodeIds.add(node.sourceAnchor.nodeId);
      }
    });
  });
  return Array.from(nodeIds);
}
function collectSeedFilePaths(seedSemanticGraphs: CanvasSemanticGraph[]): string[] {
  const filePaths = new Set<string>();
  seedSemanticGraphs.forEach((graph) => {
    if (graph.sourceSelection?.filePath) {
      filePaths.add(graph.sourceSelection.filePath);
    }
    graph.nodes.forEach((node) => {
      if (node.sourceAnchor?.kind === "code-symbol" || node.sourceAnchor?.kind === "relationship-node") {
        if (node.sourceAnchor.filePath) {
          filePaths.add(node.sourceAnchor.filePath);
        }
      }
    });
  });
  return Array.from(filePaths);
}
function collectSeedSemanticGraphs(seedSemanticGraphs: CanvasSemanticGraph[] | undefined): CanvasSemanticGraph[] {
  return (seedSemanticGraphs ?? []).map(cloneCanvasGraph);
}


export function createIntentCanvasDocument(input: {
  workspace: IntentCanvasWorkspaceRef;
  request?: IntentCanvasOpenRequest | null;
}): IntentCanvasDocument {
  const now = new Date().toISOString();
  const id = createCanvasId();
  const source = input.request?.source ?? null;
  const seedSemanticGraphs = collectSeedSemanticGraphs(input.request?.seedSemanticGraphs);
  const title =
    input.request?.title?.trim() ||
    source?.nodeTitle?.trim() ||
    source?.filePath?.trim() ||
    t("未命名意图画布");
  const summary = input.request?.summary?.trim() || source?.summary?.trim() || "";
  const links: IntentCanvasLinks = {
    projectMapNodeIds: uniqueStrings([
      ...source?.projectMapNodeId ? [source.projectMapNodeId] : [],
      ...collectSeedProjectMapNodeIds(seedSemanticGraphs),
    ]),
    filePaths: uniqueStrings([
      ...source?.filePath ? [source.filePath] : [],
      ...collectSeedFilePaths(seedSemanticGraphs),
    ]),
    threadIds: [],
  };
  const scene = createInitialIntentCanvasScene(source, seedSemanticGraphs);
  return {
    version: 1,
    id,
    title,
    kind: "intent-canvas",
    createdAt: now,
    updatedAt: now,
    workspace: input.workspace,
    mode: input.request?.mode ?? "architect",
    summary,
    links,
    scene,
    aiContext: buildIntentCanvasAiContext(scene, summary),
    semanticGraphs: seedSemanticGraphs,
    aiAnnotations: [],
  };
}


function getIntentCanvasSceneRightEdge(scene: IntentCanvasScene): number {
  return scene.elements.reduce((rightEdge, element) => {
    const rawElement = element as unknown as Record<string, unknown>;
    const x = typeof rawElement.x === "number" && Number.isFinite(rawElement.x) ? rawElement.x : 0;
    const width = typeof rawElement.width === "number" && Number.isFinite(rawElement.width) ? rawElement.width : 0;
    /* 负宽元素(如 AI 反向箭头 width=终点偏移)实际包络右缘是 x 本身。 */
    return Math.max(rightEdge, x, x + width);
  }, 0);
}

function offsetIntentCanvasScene(scene: IntentCanvasScene, offsetX: number, offsetY: number): IntentCanvasScene {
  const elements = scene.elements.map((element) => {
    const rawElement = element as unknown as Record<string, unknown>;
    return {
      ...rawElement,
      x: typeof rawElement.x === "number" && Number.isFinite(rawElement.x)
        ? rawElement.x + offsetX
        : rawElement.x,
      y: typeof rawElement.y === "number" && Number.isFinite(rawElement.y)
        ? rawElement.y + offsetY
        : rawElement.y,
    };
  }) as unknown as IntentCanvasScene["elements"];
  return sanitizeIntentCanvasScene(elements, scene.appState, scene.files);
}

export function appendIntentCanvasScene(currentScene: IntentCanvasScene, appendedScene: IntentCanvasScene): IntentCanvasScene {
  const currentRightEdge = getIntentCanvasSceneRightEdge(currentScene);
  const offsetX = currentRightEdge > 0 ? Math.ceil((currentRightEdge + 160) / 40) * 40 : 0;
  const shiftedScene = offsetIntentCanvasScene(appendedScene, offsetX, 0);
  return sanitizeIntentCanvasScene(
    [...currentScene.elements, ...shiftedScene.elements],
    currentScene.appState,
    {
      ...currentScene.files,
      ...shiftedScene.files,
    },
  );
}

export function appendIntentCanvasSummary(currentSummary: string, nextSummary: string): string {
  const current = currentSummary.trim();
  const next = nextSummary.trim();
  if (!next || current.includes(next)) {
    return current;
  }
  return current ? `${current}\n\n${next}` : next;
}

export function appendIntentCanvasDocumentFromRequest(input: {
  document: IntentCanvasDocument;
  request: IntentCanvasOpenRequest;
}): IntentCanvasDocument {
  const now = new Date().toISOString();
  const source = input.request.source ?? null;
  const seedSemanticGraphs = collectSeedSemanticGraphs(input.request.seedSemanticGraphs);
  const appendedScene = createInitialIntentCanvasScene(source, seedSemanticGraphs);
  const scene = appendIntentCanvasScene(input.document.scene, appendedScene);
  const summary = appendIntentCanvasSummary(
    input.document.summary,
    input.request.summary?.trim() || source?.summary?.trim() || "",
  );
  const links: IntentCanvasLinks = {
    projectMapNodeIds: uniqueStrings([
      ...input.document.links.projectMapNodeIds,
      ...source?.projectMapNodeId ? [source.projectMapNodeId] : [],
      ...collectSeedProjectMapNodeIds(seedSemanticGraphs),
    ]),
    filePaths: uniqueStrings([
      ...input.document.links.filePaths,
      ...source?.filePath ? [source.filePath] : [],
      ...collectSeedFilePaths(seedSemanticGraphs),
    ]),
    threadIds: input.document.links.threadIds,
  };
  return {
    ...input.document,
    updatedAt: now,
    summary,
    links,
    scene,
    aiContext: buildIntentCanvasAiContext(scene, summary),
    semanticGraphs: [
      ...input.document.semanticGraphs.map(cloneCanvasGraph),
      ...seedSemanticGraphs,
    ],
  };
}

export function cloneIntentCanvasDocument(input: {
  workspace: IntentCanvasWorkspaceRef;
  source: IntentCanvasDocument;
}): IntentCanvasDocument {
  const now = new Date().toISOString();
  const id = createCanvasId();
  const title = t("「{title}」副本", { title: input.source.title });
  return {
    ...input.source,
    semanticGraphs: input.source.semanticGraphs.map(cloneCanvasGraph),
    aiAnnotations: input.source.aiAnnotations.map(cloneCanvasAiAnnotation),
    id,
    title,
    createdAt: now,
    updatedAt: now,
    workspace: input.workspace,
  };
}
