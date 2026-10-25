/**
 * 意图画布 · .excalidraw 文件导入测试(文件树右键深链消费链)。
 * ipc 内存桩 mirror storageAndAiDraw 先例;scene sanitize 走真实实现
 * (mirror scene.test 的 convertToExcalidrawElements 桩)。
 */
import { describe, expect, it, vi } from "vitest";

const fileByPath = new Map<string, string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsReadFile: async (path: string) => {
      if (!fileByPath.has(path)) throw new Error(`no such file: ${path}`);
      return fileByPath.get(path) ?? "";
    },
  },
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => ({ id: `mock-element-${index}`, ...element })),
}));

import { claimImportRequestId, importExcalidrawFile, parseExcalidrawFile, titleFromExcalidrawName } from "../excalidrawFileImport";
import { createIntentCanvasDocument } from "../storage/documentOps";

const VALID = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    { id: "r1", type: "rectangle", x: 0, y: 0, width: 120, height: 60 },
    { id: "t1", type: "text", x: 10, y: 10, text: "登录", isDeleted: false },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

describe("parseExcalidrawFile", () => {
  it("有效文件:场景保留元素,标题去 .excalidraw 后缀", () => {
    const { scene, title } = parseExcalidrawFile(VALID, "tiv-项目总架构-续作.excalidraw");
    expect(scene.elements).toHaveLength(2);
    expect(title).toBe("tiv-项目总架构-续作");
  });

  it("坏 JSON 与非对象根:报可读错误,不抛裸 SyntaxError", () => {
    expect(() => parseExcalidrawFile("{broken", "a.excalidraw")).toThrow("JSON 解析失败");
    expect(() => parseExcalidrawFile("[]", "a.excalidraw")).toThrow("不是有效的 Excalidraw 文件");
  });

  it("无元素/全畸形元素:报「没有可导入」不静默建空画布", () => {
    expect(() => parseExcalidrawFile(JSON.stringify({ elements: [] }), "a.excalidraw")).toThrow("没有可导入的画布元素");
    expect(() => parseExcalidrawFile(JSON.stringify({ elements: [null, 3] }), "a.excalidraw")).toThrow(
      "没有可导入的画布元素",
    );
  });
});

describe("importExcalidrawFile", () => {
  it("读取失败(文件消失):文案带原因上抛", async () => {
    await expect(importExcalidrawFile("/ws/gone.excalidraw", "gone.excalidraw")).rejects.toThrow("无法读取");
  });

  it("超 512KB 前端闸早拒(存储写闸 496KB,读入必失败)", async () => {
    fileByPath.set("/ws/big.excalidraw", "x".repeat(513 * 1024));
    await expect(importExcalidrawFile("/ws/big.excalidraw", "big.excalidraw")).rejects.toThrow("超出画布存储上限");
  });

  it("端到端:盘上文件 → 场景+标题", async () => {
    fileByPath.set("/ws/tiv.excalidraw", VALID);
    const { scene, title } = await importExcalidrawFile("/ws/tiv.excalidraw", "tiv.excalidraw");
    expect(title).toBe("tiv");
    expect(scene.elements.length).toBeGreaterThan(0);
  });
});

describe("claimImportRequestId 跨重挂去重", () => {
  it("同 requestId 二次消费拒绝(重挂重放不二次导入),新 id 放行", () => {
    const id = Date.now();
    expect(claimImportRequestId(id)).toBe(true);
    expect(claimImportRequestId(id)).toBe(false);
    expect(claimImportRequestId(id + 1)).toBe(true);
  });

  it("容量上限:超限整体清空,旧 id 可重导(代价仅一次右键)", () => {
    const base = 1_000_000_000_000;
    for (let i = 0; i <= 501; i++) claimImportRequestId(base + i);
    expect(claimImportRequestId(base)).toBe(true); // 已被清空重置
  });
});

describe("titleFromExcalidrawName", () => {
  it("大小写不敏感去后缀;空名回落", () => {
    expect(titleFromExcalidrawName("架构.EXCALIDRAW")).toBe("架构");
    expect(titleFromExcalidrawName("   ")).toBe("导入的画布");
  });
});

describe("createIntentCanvasDocument seedScene", () => {
  it("种子场景替代空场景,aiContext 随同一场景构建", () => {
    const { scene } = parseExcalidrawFile(VALID, "seed.excalidraw");
    const document = createIntentCanvasDocument({
      workspace: { id: "ws-1", name: "demo" },
      request: {
        requestId: 1,
        mode: "architect",
        title: "导入画布",
        source: { filePath: "/ws/tiv.excalidraw" },
        seedScene: scene,
      },
    });
    expect(document.scene.elements).toHaveLength(scene.elements.length);
    expect(document.aiContext.elementDigest.length).toBe(scene.elements.length);
    expect(document.links.filePaths).toContain("/ws/tiv.excalidraw");
  });
});
