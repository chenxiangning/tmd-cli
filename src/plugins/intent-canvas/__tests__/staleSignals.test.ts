import { describe, expect, it } from "vitest";
import type { IntentCanvasDocument, IntentCanvasIndexEntry } from "../types";
import {
  deriveCanvasStaleBadge,
  documentHasBrokenAnchors,
  EMPTY_GRAPH_ELEMENT_THRESHOLD,
} from "../utils/staleSignals";

const NOW = new Date(2026, 7, 13, 12, 0, 0);

function createEntry(elementCount: number, updatedAt: Date): IntentCanvasIndexEntry {
  return {
    id: "canvas-1",
    title: "Canvas",
    mode: "architect",
    summary: "",
    updatedAt: updatedAt.toISOString(),
    createdAt: updatedAt.toISOString(),
    path: "canvas-1.intent-canvas.json",
    linkedFileCount: 0,
    linkedProjectMapNodeCount: 0,
    linkedThreadCount: 0,
    elementCount,
  };
}

function createDocument(graphs: Partial<IntentCanvasDocument["semanticGraphs"][number]>[]): IntentCanvasDocument {
  return {
    version: 1,
    id: "canvas-1",
    title: "Canvas",
    kind: "intent-canvas",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    workspace: { id: "workspace-1", name: null },
    mode: "architect",
    summary: "",
    links: { projectMapNodeIds: [], filePaths: [], threadIds: [] },
    scene: { elements: [], appState: {}, files: {} },
    aiContext: { elementDigest: [], relationDigest: [], lastContextSnapshot: "" },
    semanticGraphs: graphs.map((graph, index) => ({
      graphId: `graph-${index}`,
      createdAt: NOW.toISOString(),
      nodes: [],
      edges: [],
      ...graph,
    })),
    aiAnnotations: [],
  };
}

describe("documentHasBrokenAnchors", () => {
  it("returns false for documents without semantic graphs", () => {
    expect(documentHasBrokenAnchors(createDocument([]))).toBe(false);
  });

  it("detects unresolved or stale nodes and edges", () => {
    expect(
      documentHasBrokenAnchors(
        createDocument([
          { nodes: [{ id: "n1", label: "n", kind: "file", unresolved: true }] },
        ]),
      ),
    ).toBe(true);
    expect(
      documentHasBrokenAnchors(
        createDocument([
          {
            edges: [
              {
                id: "e1",
                sourceNodeId: "a",
                targetNodeId: "b",
                relationKind: "calls",
                stale: true,
              },
            ],
          },
        ]),
      ),
    ).toBe(true);
    expect(
      documentHasBrokenAnchors(
        createDocument([{ nodes: [{ id: "n1", label: "n", kind: "file" }] }]),
      ),
    ).toBe(false);
  });
});

describe("deriveCanvasStaleBadge", () => {
  const staleDate = new Date(2026, 4, 1, 12, 0, 0); // 104 天前

  it("prioritizes broken anchors over empty graph and inactivity", () => {
    const badge = deriveCanvasStaleBadge({
      entry: createEntry(0, staleDate),
      anchorHealth: "broken",
      now: NOW,
    });
    expect(badge).toEqual({ kind: "anchors-broken" });
  });

  it("falls back to empty-graph when anchor health is unknown", () => {
    const badge = deriveCanvasStaleBadge({
      entry: createEntry(EMPTY_GRAPH_ELEMENT_THRESHOLD, staleDate),
      anchorHealth: "unknown",
      now: NOW,
    });
    expect(badge).toEqual({ kind: "empty-graph" });
  });

  it("reports inactivity days for healthy non-empty canvases", () => {
    const badge = deriveCanvasStaleBadge({
      entry: createEntry(10, staleDate),
      anchorHealth: "ok",
      now: NOW,
    });
    expect(badge).toEqual({ kind: "inactive", days: 104 });
  });

  it("treats unknown anchor health the same as ok for non-empty canvases", () => {
    const badge = deriveCanvasStaleBadge({
      entry: createEntry(10, staleDate),
      anchorHealth: "unknown",
      now: NOW,
    });
    expect(badge.kind).toBe("inactive");
  });
});
