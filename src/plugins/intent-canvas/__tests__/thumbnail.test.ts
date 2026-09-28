import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentCanvasScene } from "../types";
import {
  buildIntentCanvasThumbnailSvg,
  THUMBNAIL_MAX_CHARS,
  THUMBNAIL_MAX_ELEMENTS,
} from "../utils/thumbnail";

const exportToSvgMock = vi.fn();

vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: (...args: unknown[]) => exportToSvgMock(...args),
}));

function createScene(elementCount: number): IntentCanvasScene {
  return {
    elements: Array.from({ length: elementCount }, (_, index) => ({
      id: `el-${index}`,
      type: "rectangle",
      isDeleted: false,
    })) as unknown as IntentCanvasScene["elements"],
    appState: {},
    files: {},
  };
}

function svgOfLength(length: number): SVGElement {
  /* node 环境无 DOM:被测代码只读 outerHTML,用纯对象桩等价替身。 */
  const padding = ' data-pad=""'.length;
  return {
    outerHTML: `<svg${"x".repeat(Math.max(0, length - padding))}></svg>`.slice(0, Math.max(0, length - padding)) + "></svg>",
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  } as unknown as SVGElement;
}

describe("buildIntentCanvasThumbnailSvg", () => {
  beforeEach(() => {
    exportToSvgMock.mockReset();
    exportToSvgMock.mockResolvedValue(svgOfLength(200));
  });

  it("returns null for an empty scene without calling exportToSvg", async () => {
    expect(await buildIntentCanvasThumbnailSvg(createScene(0))).toBeNull();
    expect(exportToSvgMock).not.toHaveBeenCalled();
  });

  it("exports non-deleted elements without inlining files", async () => {
    const scene = createScene(3);
    (scene.elements[1] as unknown as { isDeleted: boolean }).isDeleted = true;

    const result = await buildIntentCanvasThumbnailSvg(scene);

    expect(result).toContain("<svg");
    const [args] = exportToSvgMock.mock.calls[0] as [
      { elements: unknown[]; files: unknown },
    ];
    expect(args.elements).toHaveLength(2);
    expect(args.files).toBeNull();
  });

  it("caps exported elements at the budget", async () => {
    const scene = createScene(THUMBNAIL_MAX_ELEMENTS + 20);

    await buildIntentCanvasThumbnailSvg(scene);

    const [args] = exportToSvgMock.mock.calls[0] as [{ elements: unknown[] }];
    expect(args.elements).toHaveLength(THUMBNAIL_MAX_ELEMENTS);
  });

  it("drops thumbnails exceeding the size budget", async () => {
    exportToSvgMock.mockResolvedValue(svgOfLength(THUMBNAIL_MAX_CHARS + 10));

    expect(await buildIntentCanvasThumbnailSvg(createScene(2))).toBeNull();
  });

  it("returns null when export fails", async () => {
    exportToSvgMock.mockRejectedValue(new Error("boom"));

    expect(await buildIntentCanvasThumbnailSvg(createScene(2))).toBeNull();
  });
});
