/**
 * 意图画布 · 场景引擎(mossx utils/scene.ts 966 行按职责拆分,移植)。
 * 本文件:种子图形与元素工厂;graph:语义图投影;repair:生成元素修复;state:sanitize/初始场景/AI 上下文。
  * 本文件:语义图 → 网格布局图形投影(节点/箭头/绑定标签)。
 */
import type { CanvasSemanticGraph, CanvasSemanticNode } from "../types";
import { compactCanvasLabel, createSeedShapeId, type SeedShape } from "./sceneElements";

export type GraphNodePlacement = {
  node: CanvasSemanticNode;
  elementId: string;
  textElementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};


const GRAPH_NODE_WIDTH = 260;
const GRAPH_NODE_HEIGHT = 92;
const GRAPH_COLUMN_GAP = 340;
const GRAPH_ROW_GAP = 132;

function getNodePathLabel(node: CanvasSemanticNode): string {
  const anchor = node.sourceAnchor;
  if (anchor?.kind === "relationship-node" || anchor?.kind === "code-symbol") {
    return compactCanvasLabel(anchor.filePath, node.summary ?? "");
  }
  return compactCanvasLabel(node.summary, "");
}

function getNodeRoleLabel(node: CanvasSemanticNode): string {
  const anchor = node.sourceAnchor;
  if (anchor?.kind === "relationship-node") {
    return compactCanvasLabel(anchor.nodeKind, node.kind);
  }
  if (anchor?.kind === "code-symbol") {
    return compactCanvasLabel(anchor.symbolKind, node.kind);
  }
  const roleMatch = node.summary?.match(/role:([^;]+)/);
  return compactCanvasLabel(roleMatch?.[1], node.kind);
}

function getNodePalette(node: CanvasSemanticNode, isCenterNode: boolean): {
  strokeColor: string;
  backgroundColor: string;
  textColor: string;
} {
  if (node.kind === "group") {
    return { strokeColor: "#d97706", backgroundColor: "#fff7ed", textColor: "#92400e" };
  }
  if (isCenterNode) {
    return { strokeColor: "#0891b2", backgroundColor: "#ecfeff", textColor: "#0e7490" };
  }
  const role = getNodeRoleLabel(node).toLowerCase();
  if (role.includes("controller")) {
    return { strokeColor: "#2563eb", backgroundColor: "#eff6ff", textColor: "#1d4ed8" };
  }
  if (role.includes("service")) {
    return { strokeColor: "#059669", backgroundColor: "#ecfdf5", textColor: "#047857" };
  }
  if (role.includes("hook")) {
    return { strokeColor: "#0d9488", backgroundColor: "#f0fdfa", textColor: "#0f766e" };
  }
  if (role.includes("test")) {
    return { strokeColor: "#65a30d", backgroundColor: "#f7fee7", textColor: "#4d7c0f" };
  }
  if (role.includes("config") || role.includes("manifest")) {
    return { strokeColor: "#d97706", backgroundColor: "#fffbeb", textColor: "#92400e" };
  }
  return { strokeColor: "#64748b", backgroundColor: "#f8fafc", textColor: "#334155" };
}

function getEdgeColor(edge: CanvasSemanticGraph["edges"][number]): string {
  if (edge.relationKind === "omitted") {
    return "#f59e0b";
  }
  if (edge.relationKind === "calls") {
    return "#22d3ee";
  }
  if (edge.relationKind === "imports") {
    return "#2dd4bf";
  }
  if (edge.relationKind === "tested_by") {
    return "#a3e635";
  }
  if (edge.relationKind === "configures") {
    return "#fbbf24";
  }
  return edge.direction === "in" ? "#60a5fa" : "#94a3b8";
}

function getGraphCenterNode(graph: CanvasSemanticGraph): CanvasSemanticNode {
  const centerNodeId = graph.importOptions?.centerNodeId;
  return graph.nodes.find((node) => node.id === centerNodeId)
    ?? graph.nodes.find((node) => node.summary?.includes("depth:0"))
    ?? graph.nodes[0]!;
}

function createGraphNodeShape(
  node: CanvasSemanticNode,
  placement: GraphNodePlacement,
  isCenterNode: boolean,
  boundArrowIds: string[],
): SeedShape[] {
  const palette = getNodePalette(node, isCenterNode);
  const title = compactCanvasLabel(node.label, "Relationship Node");
  const subtitle = getNodePathLabel(node);
  const roleLabel = getNodeRoleLabel(node);
  const summaryLabel = node.kind === "symbol" && node.summary
    ? node.summary.split(/\n|;\s*/).map((line) => line.trim()).filter(Boolean).slice(0, 3).join("\n")
    : null;
  const nodeText = [
    title,
    roleLabel ? `${roleLabel} · ${node.kind}` : node.kind,
    summaryLabel ?? subtitle,
  ].filter(Boolean).join("\n");
  return [
    {
      type: "rectangle",
      id: placement.elementId,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      strokeColor: palette.strokeColor,
      backgroundColor: palette.backgroundColor,
      boundElementIds: [placement.textElementId, ...boundArrowIds],
      strokeWidth: isCenterNode ? 3 : 2,
      roughness: 0,
    },
    {
      type: "text",
      id: placement.textElementId,
      x: placement.x + 14,
      y: placement.y + 16,
      width: placement.width - 28,
      height: placement.height - 28,
      text: nodeText,
      fontSize: isCenterNode ? 16 : 15,
      strokeColor: palette.textColor,
      containerId: placement.elementId,
    },
  ];
}

function createGraphEdgeShapes(
  graph: CanvasSemanticGraph,
  placements: Map<string, GraphNodePlacement>,
): SeedShape[] {
  const shapes: SeedShape[] = [];
  graph.edges.forEach((edge) => {
    const source = placements.get(edge.sourceNodeId);
    const target = placements.get(edge.targetNodeId);
    if (!source || !target) {
      return;
    }
    const sourceCenterX = source.x + source.width / 2;
    const sourceCenterY = source.y + source.height / 2;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    const arrowId = createSeedShapeId("edge", `${graph.graphId}-${edge.id}`);
    const labelId = createSeedShapeId("edge-label", `${graph.graphId}-${edge.id}-${edge.label ?? edge.relationKind}`);
    const edgeColor = getEdgeColor(edge);
    shapes.push({
      type: "arrow",
      id: arrowId,
      x: sourceCenterX,
      y: sourceCenterY,
      width: targetCenterX - sourceCenterX,
      height: targetCenterY - sourceCenterY,
      strokeColor: edgeColor,
      startBindingId: source.elementId,
      endBindingId: target.elementId,
      boundElementIds: [labelId],
      strokeWidth: edge.relationKind === "calls" ? 3 : 2,
      roughness: 0,
    });
    shapes.push({
      type: "text",
      id: labelId,
      x: (sourceCenterX + targetCenterX) / 2 - 90,
      y: (sourceCenterY + targetCenterY) / 2 - 22,
      width: 180,
      height: 22,
      text: compactCanvasLabel(edge.label, edge.relationKind || "relation"),
      fontSize: 12,
      strokeColor: edgeColor,
      containerId: arrowId,
    });
  });
  return shapes;
}

export function buildGraphSeedSkeleton(seedSemanticGraphs: CanvasSemanticGraph[] | undefined): SeedShape[] {
  const graph = seedSemanticGraphs?.find((candidate) => candidate.nodes.length > 0);
  if (!graph) {
    return [];
  }
  const centerNode = getGraphCenterNode(graph);
  const incomingIds = new Set(
    graph.edges
      .filter((edge) => edge.targetNodeId === centerNode.id && edge.sourceNodeId !== centerNode.id)
      .map((edge) => edge.sourceNodeId),
  );
  const outgoingIds = new Set(
    graph.edges
      .filter((edge) => edge.sourceNodeId === centerNode.id && edge.targetNodeId !== centerNode.id)
      .map((edge) => edge.targetNodeId),
  );
  const incomingNodes = graph.nodes.filter((node) => incomingIds.has(node.id));
  const outgoingNodes = graph.nodes.filter((node) => outgoingIds.has(node.id));
  const secondaryNodes = graph.nodes.filter((node) => (
    node.id !== centerNode.id && !incomingIds.has(node.id) && !outgoingIds.has(node.id)
  ));
  const maxLaneRows = Math.max(incomingNodes.length, outgoingNodes.length, 1);
  const centerY = 170 + Math.max(0, maxLaneRows - 1) * GRAPH_ROW_GAP / 2;
  const placements = new Map<string, GraphNodePlacement>();
  const placeNode = (node: CanvasSemanticNode, x: number, y: number) => {
    placements.set(node.id, {
      node,
      elementId: createSeedShapeId("node", `${graph.graphId}-${node.id}`),
      textElementId: createSeedShapeId("node-text", `${graph.graphId}-${node.id}`),
      x,
      y,
      width: GRAPH_NODE_WIDTH,
      height: node.kind === "symbol" ? 128 : GRAPH_NODE_HEIGHT,
    });
  };
  incomingNodes.forEach((node, index) => placeNode(node, 80, 130 + index * GRAPH_ROW_GAP));
  placeNode(centerNode, 80 + GRAPH_COLUMN_GAP, centerY);
  outgoingNodes.forEach((node, index) => {
    const lane = index % 2;
    const row = Math.floor(index / 2);
    placeNode(node, 80 + GRAPH_COLUMN_GAP * 2 + lane * 300, 130 + row * GRAPH_ROW_GAP);
  });
  secondaryNodes.forEach((node, index) => {
    placeNode(node, 80 + GRAPH_COLUMN_GAP + (index % 2) * GRAPH_COLUMN_GAP, centerY + 190 + Math.floor(index / 2) * GRAPH_ROW_GAP);
  });
  const boundArrowIdsByNodeId = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    const arrowId = createSeedShapeId("edge", `${graph.graphId}-${edge.id}`);
    const sourceArrowIds = boundArrowIdsByNodeId.get(edge.sourceNodeId) ?? [];
    const targetArrowIds = boundArrowIdsByNodeId.get(edge.targetNodeId) ?? [];
    sourceArrowIds.push(arrowId);
    targetArrowIds.push(arrowId);
    boundArrowIdsByNodeId.set(edge.sourceNodeId, sourceArrowIds);
    boundArrowIdsByNodeId.set(edge.targetNodeId, targetArrowIds);
  });
  const nodeShapes = Array.from(placements.values()).flatMap((placement) => (
    createGraphNodeShape(
      placement.node,
      placement,
      placement.node.id === centerNode.id,
      boundArrowIdsByNodeId.get(placement.node.id) ?? [],
    )
  ));
  return [
    ...createGraphEdgeShapes(graph, placements),
    ...nodeShapes,
  ];
}




