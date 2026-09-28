import type { IntentCanvasDocument, IntentCanvasIndexEntry } from "../types";

export const EMPTY_GRAPH_ELEMENT_THRESHOLD = 3;

export type CanvasAnchorHealth = "broken" | "ok" | "unknown";

export type CanvasStaleBadge =
  | { kind: "anchors-broken" }
  | { kind: "empty-graph" }
  | { kind: "inactive"; days: number };

/** 扫描 semantic graphs，存在 unresolved 或 stale 的节点/边即视为锚点失效。 */
export function documentHasBrokenAnchors(document: IntentCanvasDocument): boolean {
  return document.semanticGraphs.some(
    (graph) =>
      graph.nodes.some((node) => node.unresolved === true || node.stale === true) ||
      graph.edges.some((edge) => edge.unresolved === true || edge.stale === true),
  );
}

/**
 * 「更早」组卡片的治理角标：锚点失效 > 空图 > N 天未动。
 * anchorHealth 为 unknown（未加载或读取失败）时静默降级到后续档位。
 */
export function deriveCanvasStaleBadge(input: {
  entry: IntentCanvasIndexEntry;
  anchorHealth: CanvasAnchorHealth;
  now: Date;
}): CanvasStaleBadge {
  if (input.anchorHealth === "broken") {
    return { kind: "anchors-broken" };
  }
  if (input.entry.elementCount <= EMPTY_GRAPH_ELEMENT_THRESHOLD) {
    return { kind: "empty-graph" };
  }
  const updatedTime = new Date(input.entry.updatedAt).getTime();
  const days = Number.isFinite(updatedTime)
    ? Math.max(0, Math.floor((input.now.getTime() - updatedTime) / (24 * 60 * 60 * 1000)))
    : 0;
  return { kind: "inactive", days };
}
