/**
 * 意图画布 · 保存事务与索引预算测试:文档写+索引更新的全有或全无回滚、
 * 超限剥缩略图的「最旧优先、够用即止」。内存 fs 桩 mirror storageAndAiDraw 先例。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileByPath = new Map<string, string>();
/* 失败注入:blockWrites 非空时对命中路径的写/删 reject 一次即清(回滚链分支测试)。 */
const blockWrites = new Set<string>();
const blockRemoves = new Set<string>();

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
      if (blockWrites.has(path)) {
        blockWrites.delete(path);
        throw new Error(`injected write failure: ${path}`);
      }
      fileByPath.set(path, content);
    },
    fsCreateDir: async () => undefined,
    fsTrashEntry: async (path: string) => {
      fileByPath.delete(path);
    },
    fsRemovePath: async (path: string) => {
      if (blockRemoves.has(path)) {
        blockRemoves.delete(path);
        throw new Error(`injected remove failure: ${path}`);
      }
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

import { deleteIntentCanvasDocument, loadIntentCanvasIndex, saveIntentCanvasDocument } from "../storage/documents";
import { createIntentCanvasDocument } from "../storage/documentOps";
import { canvasDir, INTENT_CANVAS_INDEX_PATH, resolveDocumentPath } from "../storage/paths";

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

  it("索引写失败同样回滚文档写(新建删文件、覆写还原旧字节)", async () => {
    const first = (await saveIntentCanvasDocument(ROOT, makeDoc(1, "画布丁"))).document;
    const docPath = docPaths()[0]!;
    const before = fileByPath.get(docPath);
    const indexPath = [...fileByPath.keys()].find((p) => p.endsWith("index.json"))!;
    blockWrites.add(indexPath);
    await expect(saveIntentCanvasDocument(ROOT, { ...first, title: "又改名" })).rejects.toThrow("injected");
    expect(fileByPath.get(docPath)).toBe(before);
    expect(fileByPath.has(indexPath)).toBe(true);
  });

  it("回滚自身失败不静默:warn + 半写态,孤儿认领让同一文档重存自愈", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const doc = makeDoc(1, "孤儿画布");
    const docPath = `${await canvasDir(ROOT)}/${resolveDocumentPath(doc.id)}`;
    const indexPath = `${await canvasDir(ROOT)}/${INTENT_CANVAS_INDEX_PATH}`;
    fileByPath.set(indexPath, "{broken json");
    blockRemoves.add(docPath);
    await expect(saveIntentCanvasDocument(ROOT, doc)).rejects.toThrow("索引");
    /* 回滚删除被注入失败:文档维持半写态 + warn 告警。 */
    expect(warn).toHaveBeenCalled();
    expect(JSON.parse(fileByPath.get(docPath)!).title).toBe("孤儿画布");
    /* 修复索引后重存同一张:覆写闸凭孤儿认领(盘上字节 = 上次写入)放行,不再恒拦死。 */
    fileByPath.delete(indexPath);
    const healed = await saveIntentCanvasDocument(ROOT, doc);
    expect(healed.document.id).toBe(doc.id);
    expect(docPaths()).toHaveLength(1);
  });

  it("删除遇坏索引:原索引原样保留(不整表覆盖)", async () => {
    await saveIntentCanvasDocument(ROOT, makeDoc(1, "待删画布"));
    const indexPath = [...fileByPath.keys()].find((p) => p.endsWith("index.json"))!;
    fileByPath.set(indexPath, "{broken json");
    const canvasId = docPaths()[0]!.split("/").pop()!.replace(".json", "");
    await expect(deleteIntentCanvasDocument(ROOT, canvasId)).rejects.toThrow("索引");
    expect(fileByPath.get(indexPath)).toBe("{broken json");
  });
});
