/**
 * 预览大纲契约测试:
 * - PDF:mock PDFDocumentProxy(getOutline/getDestination/getPageIndex),
 *   覆盖命名 dest、ref dest、越界页码、无目标条目剔除、子条目兜底;
 * - 文档:node 无 DOMParser → 原样返回 + 空大纲(降级守卫)。
 */

import { describe, expect, it } from "vitest";
import { extractDocumentPreviewOutline, extractPdfPreviewOutline } from "./previewOutline";

/** 与 previewOutline 内部 PdfOutlineNode 同构的测试桩形状。 */
type MockOutlineNode = {
  title: string | null;
  dest: string | Array<unknown> | null;
  items: MockOutlineNode[] | null;
};

function makeDoc(outline: MockOutlineNode[], destinations: Record<string, Array<unknown>> = {}) {
  return {
    numPages: 20,
    getOutline: async () => outline,
    getDestination: async (name: string) => destinations[name] ?? null,
    getPageIndex: async (ref: { num: number }) => ref.num,
  };
}

describe("extractPdfPreviewOutline", () => {
  it("命名 dest 经 getDestination 解析到页码", async () => {
    const doc = makeDoc(
      [{ title: "第一章", dest: "ch1", items: null }],
      { ch1: [{ num: 2, gen: 0 }] },
    );
    const items = await extractPdfPreviewOutline(doc as never, "未命名");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "第一章", level: 1 });
    expect(items[0]!.target).toEqual({ kind: "pdf-page", pageNumber: 3 });
  });

  it("数字 dest 直接换算页码;ref dest 走 getPageIndex", async () => {
    const doc = makeDoc([
      { title: "A", dest: [4], items: null },
      { title: "B", dest: [{ num: 9, gen: 1 }], items: null },
    ]);
    const items = await extractPdfPreviewOutline(doc as never, "未命名");
    expect(items[0]!.target).toEqual({ kind: "pdf-page", pageNumber: 5 });
    expect(items[1]!.target).toEqual({ kind: "pdf-page", pageNumber: 10 });
  });

  it("无 dest 的父条目借第一个子条目目标;空标题回退未命名;无目标条目剔除", async () => {
    const doc = makeDoc([
      {
        title: "  ",
        dest: null,
        items: [
          { title: "子节", dest: [1], items: null },
          { title: null, dest: [99], items: null },
        ],
      },
      { title: "孤儿", dest: null, items: null },
    ]);
    const items = await extractPdfPreviewOutline(doc as never, "未命名");
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("未命名 1");
    expect(items[0]!.children).toHaveLength(1);
    expect(items[0]!.children[0]!.title).toBe("子节");
    expect(items[0]!.target).toEqual(items[0]!.children[0]!.target);
  });

  it("空 outline 返回空表", async () => {
    const doc = { ...makeDoc([]), getOutline: async () => null };
    expect(await extractPdfPreviewOutline(doc as never, "未命名")).toEqual([]);
  });
});

describe("extractDocumentPreviewOutline", () => {
  it("node 环境无 DOMParser:html 原样返回、大纲为空(降级守卫)", () => {
    const html = "<article><h1>标题</h1><p>正文</p></article>";
    const result = extractDocumentPreviewOutline(html, "未命名");
    expect(result.html).toBe(html);
    expect(result.outline).toEqual([]);
  });
});
