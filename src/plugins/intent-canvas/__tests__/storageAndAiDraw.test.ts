/**
 * 意图画布 · 存储层(sidecar ipc.fs*)与 AI 作画 inbox 协议测试。
 * 内存 fs 桩 mirror marks store.test 先例;归一化/era/上下文等纯逻辑
 * 由同目录其余移植测试覆盖。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileByPath = new Map<string, string>();
const trashed: string[] = [];
const createdDirs = new Set<string>();

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
    /* 镜像后端 fs_edit 严格「新建」语义:已存在即报错(钉死 ensureCanvasDir 契约)。 */
    fsCreateDir: async (path: string) => {
      if (createdDirs.has(path)) {
        throw new Error(`已存在: ${path}`);
      }
      createdDirs.add(path);
    },
    fsTrashEntry: async (path: string) => {
      trashed.push(path);
      fileByPath.delete(path);
    },
    fsListDir: async (path: string) =>
      [...fileByPath.keys()]
        .filter((p) => p.startsWith(`${path}/`))
        .map((p) => ({ name: p.slice(path.length + 1), path: p, isDir: false })),
  },
}));

vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: vi.fn(async () => ({
    outerHTML: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  })),
}));

import { deleteIntentCanvasDocument, loadIntentCanvasDocument, loadIntentCanvasIndex, saveIntentCanvasDocument } from "../storage/documents";
import { createIntentCanvasDocument } from "../storage/documentOps";
import { canvasDir, resolveDocumentPath } from "../storage/paths";
import {
  importAiDrawFile,
  parseAiDrawFile,
  pollAiDrawInbox,
  projectAiDrawShapes,
  type AiDrawFile,
} from "../aiDraw";

const ROOT = "/tmp/ws-demo";

beforeEach(() => {
  fileByPath.clear();
  trashed.length = 0;
  createdDirs.clear();
});

describe("intent canvas sidecar storage", () => {
  it("缺失索引回落空列表,不报错", async () => {
    const result = await loadIntentCanvasIndex(ROOT);
    expect(result.value).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("save 写文档 + 索引;load 回读一致", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "登录流程" },
    });
    const saved = await saveIntentCanvasDocument(ROOT, document);
    expect(saved.title).toBe("登录流程");

    const index = await loadIntentCanvasIndex(ROOT);
    expect(index.value).toHaveLength(1);
    expect(index.value[0].title).toBe("登录流程");

    const loaded = await loadIntentCanvasDocument(ROOT, saved.id);
    expect(loaded.id).toBe(saved.id);
    expect(loaded.kind).toBe("intent-canvas");
  });

  it("delete 移入废纸篓并从索引摘除", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "待删除" },
    });
    const saved = await saveIntentCanvasDocument(ROOT, document);
    await deleteIntentCanvasDocument(ROOT, saved.id);
    expect(trashed.some((p) => p.includes(saved.id))).toBe(true);
    const index = await loadIntentCanvasIndex(ROOT);
    expect(index.value).toHaveLength(0);
  });

  it("非法 canvasId 拒绝落盘路径穿越", async () => {
    await expect(loadIntentCanvasDocument(ROOT, "../escape")).rejects.toThrow();
  });

  it("盘上文档比内存新时拒绝整文档覆写(stale 闸)", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "并发画布" },
    });
    await saveIntentCanvasDocument(ROOT, document);
    /* 模拟编辑器打开期间 AI 导入落盘(盘上 updatedAt 更新)。 */
    const path = [...fileByPath.keys()].find((p) => p.includes(document.id))!;
    const onDisk = JSON.parse(fileByPath.get(path)!);
    onDisk.updatedAt = "2099-01-01T00:00:00.000Z";
    fileByPath.set(path, JSON.stringify(onDisk));
    await expect(saveIntentCanvasDocument(ROOT, document)).rejects.toThrow("重新打开");
  });

  it("索引读取失败时中止索引覆写,修好后保存自愈", async () => {
    const first = await saveIntentCanvasDocument(ROOT, createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "画布甲" },
    }));
    const indexPath = [...fileByPath.keys()].find((p) => p.endsWith("index.json"))!;
    fileByPath.set(indexPath, "{broken json");
    await expect(saveIntentCanvasDocument(ROOT, createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 2, mode: "architect", title: "画布乙" },
    }))).rejects.toThrow("索引");
    /* 中止覆写:坏索引原样保留(没有被空快照整表覆盖)。 */
    expect(fileByPath.get(indexPath)).toBe("{broken json");
    /* 自愈路径:移除损坏索引(missing 语义回落空列表)后重存,条目重建。 */
    fileByPath.delete(indexPath);
    await saveIntentCanvasDocument(ROOT, first);
    await saveIntentCanvasDocument(ROOT, createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 3, mode: "architect", title: "画布乙" },
    }));
    const index = await loadIntentCanvasIndex(ROOT);
    expect(index.value.map((entry) => entry.title).sort()).toEqual(["画布乙", "画布甲"]);
    expect(first.title).toBe("画布甲");
  });

  it("超过读闸尺寸的文档拒绝保存(防存得进打不开)", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "大画布" },
    });
    const filler = "x".repeat(520 * 1024);
    const bloated = {
      ...document,
      scene: { ...document.scene, elements: [{ ...document.scene.elements[0], customData: { filler } } as (typeof document.scene.elements)[number]] },
    };
    await expect(saveIntentCanvasDocument(ROOT, bloated)).rejects.toThrow("496KB");
  });
});

describe("ai draw inbox protocol", () => {
  const validFile: AiDrawFile = {
    kind: "intent-canvas-ai-draw",
    version: 1,
    mode: "new",
    title: "架构草图",
    summary: "两层架构",
    shapes: [
      { type: "rectangle", x: 0, y: 0, width: 260, height: 92, label: "网关", fill: "#eff6ff" },
      { type: "arrow", x: 260, y: 46, width: 120, height: 0 },
      { type: "text", x: 420, y: 40, width: 120, height: 24, label: "DB" },
    ],
  };

  it("parse 拒绝非协议 JSON 与坏 shapes", () => {
    expect(() => parseAiDrawFile('{"kind":"other"}')).toThrow();
    expect(() => parseAiDrawFile(JSON.stringify({ ...validFile, shapes: [] }))).toThrow();
    expect(() =>
      parseAiDrawFile(JSON.stringify({ ...validFile, shapes: [{ type: "rect", x: 0, y: 0, width: 1, height: 1 }] })),
    ).toThrow();
  });

  it("shapes 投影出元素与绑定文本", () => {
    const shapes = projectAiDrawShapes(validFile.shapes);
    const texts = shapes.filter((s) => s.type === "text");
    expect(texts.some((s) => s.text === "网关")).toBe(true);
    expect(shapes.some((s) => s.type === "rectangle")).toBe(true);
  });

  it("AI 指定 canvasId 指向不可读文档时报错而非静默新建", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "超限画布" },
    });
    const filler = "x".repeat(520 * 1024);
    const bloated = {
      ...document,
      scene: { ...document.scene, elements: [{ ...document.scene.elements[0], customData: { filler } } as (typeof document.scene.elements)[number]] },
    };
    /* 直接落盘一个超限文档(绕过保存闸,模拟历史遗留大文件)。 */
    fileByPath.set(`${await canvasDir(ROOT)}/${resolveDocumentPath(document.id)}`, JSON.stringify(bloated));
    await expect(importAiDrawFile(ROOT, { ...validFile, mode: "append", canvasId: document.id }, { id: "ws-1", name: "demo" })).rejects.toThrow();
    /* 未静默新建重名画布:索引不存在(没有新文档写入)。 */
    expect(await loadIntentCanvasIndex(ROOT)).toEqual({ value: [], warnings: [] });
  });

  it("poll 导入 new 指令 → 新画布入库;源文件消费删除", async () => {
    const inbox = `${await (await import("../storage/paths")).aiInboxDir(ROOT)}`;
    fileByPath.set(`${inbox}/ai-draw-1.json`, JSON.stringify(validFile));
    const imported = await pollAiDrawInbox(ROOT);
    expect(imported).toHaveLength(1);
    expect(imported[0].title).toBe("架构草图");
    expect(imported[0].id).toMatch(/^canvas-/);
    expect(fileByPath.has(`${inbox}/ai-draw-1.json`)).toBe(false);
    const index = await loadIntentCanvasIndex(ROOT);
    expect(index.value.map((e) => e.title)).toContain("架构草图");
  });

  it("append 指令按 canvasId 落进既有画布", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "主画布" },
    });
    const saved = await saveIntentCanvasDocument(ROOT, document);
    const inbox = `${await (await import("../storage/paths")).aiInboxDir(ROOT)}`;
    fileByPath.set(
      `${inbox}/ai-draw-2.json`,
      JSON.stringify({ ...validFile, mode: "append", canvasId: saved.id, title: undefined }),
    );
    const imported = await pollAiDrawInbox(ROOT);
    expect(imported).toHaveLength(1);
    expect(imported[0].title).toBe("主画布");
    expect(imported[0].id).toBe(saved.id);
    const loaded = await loadIntentCanvasDocument(ROOT, saved.id);
    expect(loaded.scene.elements.length).toBeGreaterThan(0);
  });

  it("坏文件移入 failed 留证,不阻断其余导入", async () => {
    const inbox = `${await (await import("../storage/paths")).aiInboxDir(ROOT)}`;
    fileByPath.set(`${inbox}/ai-draw-bad.json`, "{not json");
    fileByPath.set(`${inbox}/ai-draw-good.json`, JSON.stringify(validFile));
    const imported = await pollAiDrawInbox(ROOT);
    expect(imported).toHaveLength(1);
    expect(imported[0].title).toBe("架构草图");
    expect(imported[0].id).toMatch(/^canvas-/);
    const failedDir = `${inbox}/failed`;
    expect([...fileByPath.keys()].some((p) => p.startsWith(failedDir))).toBe(true);
  });

  it("importAiDrawFile 单文件直导", async () => {
    const result = await importAiDrawFile(ROOT, parseAiDrawFile(JSON.stringify(validFile)));
    expect(result).toMatchObject({ ok: true, canvasTitle: "架构草图" });
    expect(result.canvasId).toMatch(/^canvas-/);
  });

  it("重复导入同一画布不产生重复元素 id(ai-draw 前缀进 repair 去重白名单)", async () => {
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: { requestId: 1, mode: "architect", title: "追加目标" },
    });
    const saved = await saveIntentCanvasDocument(ROOT, document);
    const inbox = `${await (await import("../storage/paths")).aiInboxDir(ROOT)}`;
    for (const name of ["ai-draw-a.json", "ai-draw-b.json"]) {
      fileByPath.set(
        `${inbox}/${name}`,
        JSON.stringify({ ...validFile, mode: "append", canvasId: saved.id, title: undefined }),
      );
    }
    await pollAiDrawInbox(ROOT);
    const loaded = await loadIntentCanvasDocument(ROOT, saved.id);
    const ids = loaded.scene.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
