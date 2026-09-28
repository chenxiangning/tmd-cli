import {
  buildElementLabelIndex,
  countVisualElements,
  normalizeText,
} from "./contextDigest";
import type {
  CanvasSemanticEdge,
  CanvasSemanticNode,
  IntentCanvasContextCompleteness,
  IntentCanvasDocument,
  IntentCanvasRelationDigest,
  IntentCanvasTransmissionContext,
  IntentCanvasTransmissionEvidence,
  IntentCanvasTransmissionSemanticEdge,
  IntentCanvasTransmissionSemanticNode,
  IntentCanvasTransmissionVisualArrow,
} from "../types";

const SEMANTIC_NODE_SEND_LIMIT = 240;
const SEMANTIC_EDGE_SEND_LIMIT = 480;
const EVIDENCE_SEND_LIMIT = 240;
const VISUAL_TEXT_SEND_LIMIT = 120;
const VISUAL_ARROW_SEND_LIMIT = 160;

function capItems<T>(items: T[], limit: number): { sent: T[]; omitted: number } {
  return {
    sent: items.slice(0, limit),
    omitted: Math.max(0, items.length - limit),
  };
}


function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seenKeys = new Set<string>();
  const result: T[] = [];
  items.forEach((item) => {
    const key = getKey(item);
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    result.push(item);
  });
  return result;
}






function getSemanticNodeFilePath(node: CanvasSemanticNode): string | null {
  const anchor = node.sourceAnchor;
  if (anchor?.kind === "relationship-node" || anchor?.kind === "code-symbol") {
    return normalizeText(anchor.filePath);
  }
  return null;
}

function getSemanticNodeRole(node: CanvasSemanticNode): string | null {
  const anchor = node.sourceAnchor;
  if (anchor?.kind === "relationship-node") {
    return normalizeText(anchor.nodeKind);
  }
  if (anchor?.kind === "code-symbol") {
    return normalizeText(anchor.symbolKind);
  }
  const roleMatch = node.summary?.match(/role:([^;]+)/);
  return normalizeText(roleMatch?.[1] ?? null);
}

function toTransmissionSemanticNode(node: CanvasSemanticNode): IntentCanvasTransmissionSemanticNode {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    filePath: getSemanticNodeFilePath(node),
    role: getSemanticNodeRole(node),
    summary: normalizeText(node.summary),
  };
}

function toTransmissionSemanticEdge(edge: CanvasSemanticEdge): IntentCanvasTransmissionSemanticEdge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    relation: edge.relationKind,
    label: normalizeText(edge.label),
    evidenceIds: edge.evidenceIds?.length ? edge.evidenceIds : undefined,
  };
}

function collectSemanticNodes(document: IntentCanvasDocument): IntentCanvasTransmissionSemanticNode[] {
  return uniqueByKey(
    document.semanticGraphs.flatMap((graph) => graph.nodes.map(toTransmissionSemanticNode)),
    (node) => node.id,
  );
}

function collectSemanticEdges(document: IntentCanvasDocument): IntentCanvasTransmissionSemanticEdge[] {
  return uniqueByKey(
    document.semanticGraphs.flatMap((graph) => graph.edges.map(toTransmissionSemanticEdge)),
    (edge) => edge.id,
  );
}

function collectSemanticEvidence(
  edges: IntentCanvasTransmissionSemanticEdge[],
): IntentCanvasTransmissionEvidence[] {
  return uniqueByKey(
    edges.flatMap((edge) => (edge.evidenceIds ?? []).map((evidenceId) => ({
      id: evidenceId,
      summary: edge.label
        ? `${edge.source} -> ${edge.target}: ${edge.label}`
        : `${edge.source} -> ${edge.target}: ${edge.relation}`,
    }))),
    (evidence) => evidence.id,
  );
}


function toTransmissionVisualArrow(
  relation: IntentCanvasRelationDigest,
  labelsByElementId: ReadonlyMap<string, string>,
): IntentCanvasTransmissionVisualArrow {
  return {
    id: relation.id,
    from: relation.startBindingId ? labelsByElementId.get(relation.startBindingId) ?? relation.startBindingId : null,
    to: relation.endBindingId ? labelsByElementId.get(relation.endBindingId) ?? relation.endBindingId : null,
    label: normalizeText(relation.label),
  };
}

export function buildIntentCanvasTransmissionContext(
  document: IntentCanvasDocument,
  workspaceName?: string | null,
): IntentCanvasTransmissionContext {
  const visualCounts = countVisualElements(document);
  const semanticNodes = collectSemanticNodes(document);
  const semanticEdges = collectSemanticEdges(document);
  const semanticEvidence = collectSemanticEvidence(semanticEdges);
  const labelsByElementId = buildElementLabelIndex(document.aiContext.elementDigest);
  const visualArrows = document.aiContext.relationDigest.map((relation) =>
    toTransmissionVisualArrow(relation, labelsByElementId),
  );
  const sentVisualDigestElementCount = Math.min(
    document.aiContext.elementDigest.length,
    visualCounts.totalElements,
  );
  const omittedVisualDigestElementCount = Math.max(
    0,
    visualCounts.totalElements - sentVisualDigestElementCount,
  );

  const cappedNodes = capItems(semanticNodes, SEMANTIC_NODE_SEND_LIMIT);
  const cappedEdges = capItems(semanticEdges, SEMANTIC_EDGE_SEND_LIMIT);
  const cappedEvidence = capItems(semanticEvidence, EVIDENCE_SEND_LIMIT);
  const cappedTextBlocks = capItems(visualCounts.textBlocks, VISUAL_TEXT_SEND_LIMIT);
  const cappedVisualArrows = capItems(visualArrows, VISUAL_ARROW_SEND_LIMIT);
  const totalOmitted =
    omittedVisualDigestElementCount
    + cappedNodes.omitted
    + cappedEdges.omitted
    + cappedEvidence.omitted
    + cappedTextBlocks.omitted
    + visualCounts.displayAbbreviatedTextBlockCount
    + Math.max(0, visualCounts.totalRelations - cappedVisualArrows.sent.length);
  const hasSemanticGraph = semanticNodes.length > 0 || semanticEdges.length > 0;
  const compressionMode: IntentCanvasContextCompleteness["compressionMode"] =
    totalOmitted > 0 ? "chunked" : hasSemanticGraph ? "semantic" : "compact";

  const completeness: IntentCanvasContextCompleteness = {
    elements: {
      total: visualCounts.totalElements,
      sent: sentVisualDigestElementCount,
      omitted: omittedVisualDigestElementCount,
    },
    semanticNodes: {
      total: semanticNodes.length,
      sent: cappedNodes.sent.length,
      omitted: cappedNodes.omitted,
    },
    semanticEdges: {
      total: semanticEdges.length,
      sent: cappedEdges.sent.length,
      omitted: cappedEdges.omitted,
    },
    evidence: {
      total: semanticEvidence.length,
      sent: cappedEvidence.sent.length,
      omitted: cappedEvidence.omitted,
    },
    visualTextBlocks: {
      total: visualCounts.textBlocks.length + visualCounts.displayAbbreviatedTextBlockCount,
      sent: cappedTextBlocks.sent.length,
      omitted: cappedTextBlocks.omitted + visualCounts.displayAbbreviatedTextBlockCount,
    },
    visualArrows: {
      total: visualCounts.totalRelations,
      sent: cappedVisualArrows.sent.length,
      omitted: Math.max(0, visualCounts.totalRelations - cappedVisualArrows.sent.length),
    },
    unlabeledShapeCount: visualCounts.unlabeledShapeCount,
    truncated: totalOmitted > 0,
    compressionMode,
  };

  return {
    type: "intent_canvas_context",
    version: 2,
    canvasId: document.id,
    title: document.title,
    mode: document.mode,
    workspaceName: workspaceName ?? document.workspace.name,
    summary: document.summary,
    links: document.links,
    updatedAt: document.updatedAt,
    completeness,
    semanticGraph: {
      nodes: cappedNodes.sent,
      edges: cappedEdges.sent,
      evidence: cappedEvidence.sent,
    },
    visualClues: {
      textBlocks: cappedTextBlocks.sent,
      arrows: cappedVisualArrows.sent,
      unlabeledShapeCount: visualCounts.unlabeledShapeCount,
    },
  };
}
