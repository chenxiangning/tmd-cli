import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => ({
      id: `mock-element-${index}`,
      ...element,
    })),
}));

import {
  buildIntentCanvasAiContext,
  repairIntentCanvasGeneratedElements,
  sanitizeIntentCanvasScene,
} from "../scene/sceneState";

describe("sanitizeIntentCanvasScene", () => {
  it("repairs legacy dark generated relationship elements before rendering", () => {
    const elements = repairIntentCanvasGeneratedElements([
      {
        id: "intent-node-legacy",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 260,
        height: 92,
        strokeColor: "#22d3ee",
        backgroundColor: "#05252c",
        boundElements: [{ id: "intent-node-text-legacy", type: "text" }],
      },
      {
        id: "intent-node-text-legacy",
        type: "text",
        x: 14,
        y: 16,
        width: 232,
        height: 64,
        strokeColor: "#a5f3fc",
        text: "Legacy node",
        originalText: "Legacy node",
        containerId: "intent-node-legacy",
      },
    ] as never);
    const rectangle = elements.find((element) => element.id === "intent-node-legacy") as unknown as Record<string, unknown> | undefined;
    const text = elements.find((element) => element.id === "intent-node-text-legacy") as unknown as Record<string, unknown> | undefined;

    expect(rectangle?.backgroundColor).toBe("#ecfeff");
    expect(text?.strokeColor).toBe("#0e7490");
  });

  it("drops generated relationship rectangles that have no visible label", () => {
    const elements = repairIntentCanvasGeneratedElements([
      {
        id: "intent-node-empty",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 260,
        height: 92,
        strokeColor: "#64748b",
        backgroundColor: "#f8fafc",
        boundElements: null,
      },
    ] as never);

    expect(elements).toHaveLength(0);
  });

  it("does not include deleted elements in AI context", () => {
    const scene = sanitizeIntentCanvasScene(
      [
        { id: "visible", type: "rectangle", text: "Visible", x: 0, y: 0, width: 100, height: 60 },
        { id: "deleted", type: "rectangle", text: "Deleted", isDeleted: true },
        {
          id: "deleted-edge",
          type: "arrow",
          isDeleted: true,
          startBinding: { elementId: "visible" },
        },
      ],
      {},
      {},
    );

    const context = buildIntentCanvasAiContext(scene, "summary");

    expect(context.elementDigest.map((element) => element.id)).toEqual(["visible"]);
    expect(context.relationDigest).toHaveLength(0);
  });

  it("normalizes cyclic appState and files without throwing", () => {
    const appState: Record<string, unknown> = { gridSize: 20 };
    appState.self = appState;
    const files: Record<string, unknown> = { image: { id: "image" } };
    files.self = files;

    const scene = sanitizeIntentCanvasScene([], appState, files);

    expect(scene.appState).toEqual({
      gridSize: 20,
      self: null,
    });
    expect(scene.files).toEqual({
      image: { id: "image" },
      self: null,
    });
  });
});
