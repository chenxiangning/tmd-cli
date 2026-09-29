import { describe, expect, it } from "vitest";
import type { IntentCanvasDocument } from "../types";
import { buildIntentCanvasTransmissionContext } from "../utils/context";
import { formatIntentCanvasThreadContext } from "../utils/contextFormat";

function createDocument(overrides: Partial<IntentCanvasDocument> = {}): IntentCanvasDocument {
  const baseDocument: IntentCanvasDocument = {
    version: 1,
    id: "canvas-one",
    title: "Login flow",
    kind: "intent-canvas",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    workspace: { id: "workspace-1", name: "Demo" },
    mode: "architect",
    summary: "AppUserController login relation map",
    links: {
      projectMapNodeIds: ["controller-node"],
      filePaths: ["src/main/java/AppUserController.java"],
      threadIds: [],
    },
    scene: {
      elements: [
        { id: "shape-1", type: "rectangle", isDeleted: false },
        { id: "text-1", type: "text", text: "AppUserController" },
        { id: "arrow-1", type: "arrow" },
      ] as unknown as IntentCanvasDocument["scene"]["elements"],
      appState: {},
      files: {},
    },
    aiContext: {
      elementDigest: [
        { id: "text-1", type: "text", label: "AppUserController", x: null, y: null, width: null, height: null },
      ],
      relationDigest: [
        { id: "arrow-1", type: "arrow", label: "calls", startBindingId: "text-1", endBindingId: null },
      ],
      lastContextSnapshot: "",
    },
    semanticGraphs: [
      {
        graphId: "graph-one",
        createdAt: "2026-06-06T00:00:00.000Z",
        nodes: [
          {
            id: "controller-node",
            label: "AppUserController",
            kind: "file",
            summary: "role:controller",
            sourceAnchor: {
              kind: "relationship-node",
              workspaceId: "workspace-1",
              scanRunId: "scan-one",
              nodeId: "controller-node",
              nodeKind: "controller",
              filePath: "src/main/java/AppUserController.java",
            },
          },
          {
            id: "service-node",
            label: "AuthService",
            kind: "file",
            summary: "role:service",
            sourceAnchor: {
              kind: "relationship-node",
              workspaceId: "workspace-1",
              scanRunId: "scan-one",
              nodeId: "service-node",
              nodeKind: "service",
              filePath: "src/main/java/AuthService.java",
            },
          },
        ],
        edges: [
          {
            id: "edge-one",
            sourceNodeId: "controller-node",
            targetNodeId: "service-node",
            relationKind: "calls",
            label: "authService.loginApp",
            evidenceIds: ["edge-one:evidence:0:src/main/java/AppUserController.java:42"],
          },
        ],
      },
    ],
    aiAnnotations: [],
  };
  return { ...baseDocument, ...overrides };
}

describe("Intent Canvas transmission context", () => {
  it("preserves semantic graph clues before visual drawing details", () => {
    const payload = buildIntentCanvasTransmissionContext(createDocument(), "Demo");

    expect(payload.version).toBe(2);
    expect(payload.completeness.semanticNodes).toEqual({ total: 2, sent: 2, omitted: 0 });
    expect(payload.completeness.semanticEdges).toEqual({ total: 1, sent: 1, omitted: 0 });
    expect(payload.semanticGraph.nodes.map((node) => node.filePath)).toContain(
      "src/main/java/AppUserController.java",
    );
    expect(payload.semanticGraph.edges[0]).toMatchObject({
      source: "controller-node",
      target: "service-node",
      relation: "calls",
      label: "authService.loginApp",
    });
  });

  it("makes compression explicit when visual text clues exceed the send budget", () => {
    const largeDocument = createDocument({
      scene: {
        elements: Array.from({ length: 130 }, (_, index) => ({
          id: `text-${index}`,
          type: "text",
          text: `Text clue ${index}`,
        })) as unknown as IntentCanvasDocument["scene"]["elements"],
        appState: {},
        files: {},
      },
    });

    const payload = buildIntentCanvasTransmissionContext(largeDocument, "Demo");
    const message = formatIntentCanvasThreadContext(largeDocument, "Demo");

    expect(payload.completeness.truncated).toBe(true);
    expect(payload.completeness.visualTextBlocks).toEqual({ total: 130, sent: 120, omitted: 10 });
    expect(message).toContain("Structured transmission payload compact JSON:");
    expect(message).toContain("- truncated: yes");
  });
});
