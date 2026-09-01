/**
 * attachments store 行为测试 —— 单测 store API,不测 UI 渲染(那是 AttachmentStrip.test)
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  addAttachment,
  classifyAttachment,
  clearAttachments,
  formatBytes,
  getAttachments,
  removeAttachmentById,
  removeAttachmentByPath,
  reorderAttachment,
  subscribeAttachments,
} from "./attachments";

describe("attachments store", () => {
  beforeEach(() => {
    clearAttachments();
  });

  describe("classifyAttachment", () => {
    it("识别图片", () => {
      expect(classifyAttachment("a.png", "image/png")).toBe("image");
      expect(classifyAttachment("b.jpg", "")).toBe("image");
      expect(classifyAttachment("c.svg", "")).toBe("image");
    });
    it("识别 pdf", () => {
      expect(classifyAttachment("a.pdf", "application/pdf")).toBe("pdf");
    });
    it("识别代码", () => {
      expect(classifyAttachment("a.ts", "")).toBe("code");
      expect(classifyAttachment("a.rs", "")).toBe("code");
    });
    it("其他都识别为 file", () => {
      expect(classifyAttachment("a.zip", "")).toBe("file");
      expect(classifyAttachment("a.txt", "")).toBe("file");
    });
  });

  describe("formatBytes", () => {
    it("B / KB / MB / GB 分级", () => {
      expect(formatBytes(100)).toBe("100 B");
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
      expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
    });
  });

  describe("addAttachment", () => {
    it("追加并返回带 id 的附件", () => {
      const a = addAttachment({ path: "/tmp/a.png", name: "a.png", size: 100, kind: "image", thumbDataUrl: null, previewDataUrl: null });
      expect(a.id).toBeTruthy();
      expect(getAttachments()).toHaveLength(1);
    });
    it("超过上限抛错", () => {
      for (let i = 0; i < 12; i++) {
        addAttachment({ path: `/tmp/${i}`, name: `${i}`, size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      }
      expect(() =>
        addAttachment({ path: "/tmp/13", name: "13", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null }),
      ).toThrow("上限");
    });
    it("emit 触发订阅者", () => {
      let called = 0;
      const off = subscribeAttachments(() => called++);
      addAttachment({ path: "/tmp/x", name: "x", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      expect(called).toBe(1);
      off();
      addAttachment({ path: "/tmp/y", name: "y", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      expect(called).toBe(1);
    });
  });

  describe("removeAttachment", () => {
    it("byId 移除 + emit", () => {
      const a = addAttachment({ path: "/tmp/a", name: "a", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      let called = 0;
      const off = subscribeAttachments(() => called++);
      removeAttachmentById(a.id);
      expect(called).toBe(1);
      expect(getAttachments()).toHaveLength(0);
      off();
    });
    it("byPath 移除", () => {
      addAttachment({ path: "/tmp/a", name: "a", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      addAttachment({ path: "/tmp/b", name: "b", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      removeAttachmentByPath("/tmp/a");
      expect(getAttachments()).toHaveLength(1);
      expect(getAttachments()[0].path).toBe("/tmp/b");
    });
  });

  describe("clearAttachments", () => {
    it("清空数组 + emit", () => {
      addAttachment({ path: "/tmp/a", name: "a", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      let called = 0;
      const off = subscribeAttachments(() => called++);
      clearAttachments();
      expect(called).toBe(1);
      expect(getAttachments()).toHaveLength(0);
      off();
    });
    it("空数组 no-op", () => {
      let called = 0;
      const off = subscribeAttachments(() => called++);
      clearAttachments();
      expect(called).toBe(0);
      off();
    });
  });

  describe("reorderAttachment", () => {
    it("把附件移到指定索引", () => {
      const a1 = addAttachment({ path: "/tmp/1", name: "1", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      const a2 = addAttachment({ path: "/tmp/2", name: "2", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      const a3 = addAttachment({ path: "/tmp/3", name: "3", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      expect(getAttachments().map((a) => a.id)).toEqual([a1.id, a2.id, a3.id]);
      reorderAttachment(a3.id, 0);
      expect(getAttachments().map((a) => a.id)).toEqual([a3.id, a1.id, a2.id]);
    });
    it("id 不存在 no-op", () => {
      addAttachment({ path: "/tmp/1", name: "1", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      let called = 0;
      const off = subscribeAttachments(() => called++);
      reorderAttachment("ghost", 0);
      expect(called).toBe(0);
      off();
    });
    it("同位置 no-op", () => {
      const a = addAttachment({ path: "/tmp/1", name: "1", size: 1, kind: "file", thumbDataUrl: null, previewDataUrl: null });
      let called = 0;
      const off = subscribeAttachments(() => called++);
      reorderAttachment(a.id, 0);
      expect(called).toBe(0);
      off();
    });
  });
});
