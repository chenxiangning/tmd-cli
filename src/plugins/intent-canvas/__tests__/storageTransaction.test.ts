/**
 * 意图画布 · 保存事务与索引预算测试:文档写+索引更新的全有或全无回滚、
 * 超限剥缩略图的「最旧优先、够用即止」。内存 fs 桩 mirror storageAndAiDraw 先例。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileByPath = new Map<string, string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/home/tester",
    fsReadFile: async (path: string) => {
      if (!fileByPath.has(path)) {
        throw new Error(`no such file: ${path}`);
      }
      return fileByPath.get(path) ?? "";
    },
    fsWriteFile: async (path: string, content: string) => {
      fileByPath.set(path, content);
    },
    fsCreateDir: async () => undefined,
    fsTrashEntry: async (path: string) => {
      fileByPath.delete(path);
    },
    fsRemovePath: async (path: string) => {
      fileByPath.delete(path);
    },
    fsListDir: async () => [],
  },
}));

vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: vi.fn(async () => ({
    outerHTML: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  })),
}));

import { loadIntentCanvasIndex, saveIntentCanvasDocument } from "../storage/documents";
import { createIntentCanvasDocument } from "../storage/documentOps";
import { canvasDir, INTENT_CANVAS_INDEX_PATH } from "../storage/paths";

const ROOT = "/ws/root";
const docPaths = () => [...fileByPath.keys()].filter((p) => p.endsWith(".json") && !p.endsWith("index.json"));
const makeDoc = (requestId: number, title: string) =>
  createIntentCanvasDocument({
    workspace: { id: "ws-1", name: "demo" },
    request: { requestId, mode: "architect", title },
  });

beforeEach(() => {
  fileByPath.clear();
});

describe("intent canvas save transaction", () => {
  it("索引读取失败时回滚新建文档写(保存对索引全有或全无),修好后重存重建", async () => {
    const first = (await saveIntentCanvasDocument(ROOT, makeDoc(1, "画布甲"))).document;
    expect(docPaths()).toHaveLength(1);
    const indexPath = [...fileByPath.keys()].find((p) => p.endsWith("index.json"))!;
    fileByPath.set(indexPath, "{broken json");
    await expect(saveIntentCanvasDocument(ROOT, makeDoc(2, "画布乙"))).rejects.toThrow("索引");
    /* 回滚:乙的新文档文件已删,坏索引原样保留(没有被空快照整表覆盖)。 */
    expect(docPaths()).toHaveLength(1);
    expect(fileByPath.get(indexPath)).toBe("{broken json");
    /* 修复后重存:条目重建。 */
    fileByPath.delete(indexPath);
    await saveIntentCanvasDocument(ROOT, first);
    await saveIntentCanvasDocument(ROOT, makeDoc(3, "画布乙"));
    const index = await loadIntentCanvasIndex(ROOT);
    expect(index.value.map((entry) => entry.title).sort()).toEqual(["画布乙", "画布甲"]);
    expect(first.title).toBe("画布甲");
  });

  it("索引失稳时覆写保存回滚旧字节,盘上内容不损", async () => {
    const first = (await saveIntentCanvasDocument(ROOT, makeDoc(1, "画布丙"))).document;
    const docPath = docPaths()[0]!;
    const onDiskBefore = fileByPath.get(docPath);
    const indexPath = [...fileByPath.keys()].find((p) => p.endsWith("index.json"))!;
    fileByPath.set(indexPath, "{broken json");
    await expect(saveIntentCanvasDocument(ROOT, { ...first, title: "改名" })).rejects.toThrow("索引");
    expect(fileByPath.get(docPath)).toBe(onDiskBefore);
  });

  it("索引超限时从最旧条目起剥缩略图,够用即止,最新条目保留", async () => {
    const entry = (id: string, title: string, minutes: number, thumb: string | null) => ({
      id: `canvas-${id}`,
      title,
      mode: "architect",
      summary: "",
      updatedAt: new Date(Date.parse("2026-10-01T00:00:00Z") + minutes * 60_000).toISOString(),
      createdAt: "2026-10-01T00:00:00Z",
      path: `canvases/canvas-${id}.json`,
      linkedFileCount: 0,
      linkedProjectMapNodeCount: 0,
      ...(thumb ? { thumbnailSvg: `<svg xmlns="http://www.w3.org/2000/svg">${thumb}</svg>` } : {}),
    });
    const big = "x".repeat(250 * 1024);
    const indexPath = `${await canvasDir(ROOT)}/${INTENT_CANVAS_INDEX_PATH}`;
    fileByPath.set(indexPath, JSON.stringify({
      version: 1,
      canvases: [entry("aaa", "最旧", 0, big), entry("bbb", "中间", 1, big), entry("ccc", "最新", 2, big)],
    }));
    await saveIntentCanvasDocument(ROOT, makeDoc(1, "新画布"));
    const index = await loadIntentCanvasIndex(ROOT);
    const thumbByTitle = Object.fromEntries(index.value.map((e) => [e.title, e.thumbnailSvg]));
    expect(thumbByTitle["最旧"]).toBeUndefined();
    expect(thumbByTitle["中间"]).toBeUndefined();
    expect(thumbByTitle["最新"]).toBeDefined();
  });
});
