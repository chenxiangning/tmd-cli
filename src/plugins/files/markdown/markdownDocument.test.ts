/**
 * markdown 文档编译器契约测试 —— 照抄 codemoss fileMarkdownDocument.test.ts,
 * 裁掉数学归一化(tmd 端口恒等 lineMap)相关用例。
 * 覆盖:编译缓存复用、frontmatter、切块(围栏/表格/列表原子性)、
 * progressive 策略阈值、无 leading pipe 的 GFM 表格。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearFileMarkdownDocumentCacheForTests,
  compileFileMarkdownDocument,
  segmentMarkdownDocumentBlocks,
} from "./markdownDocument";

describe("markdownDocument", () => {
  afterEach(() => {
    clearFileMarkdownDocumentCacheForTests();
  });

  it("同内容复用编译结果(缓存命中返回同一引用)", () => {
    const first = compileFileMarkdownDocument("file:/a/README.md", "# Title\n\nBody");
    const second = compileFileMarkdownDocument("file:/a/README.md", "# Title\n\nBody");

    expect(second).toBe(first);
    expect(second.body).toBe("# Title\n\nBody");
    expect(second.frontmatterFields).toEqual([]);
  });

  it("提取 frontmatter 字段,body 从 frontmatter 之后开始", () => {
    const compiled = compileFileMarkdownDocument(
      "file:/a/post.md",
      '---\ntitle: "你好"\ntags: [a, b]\n---\n\n# 正文',
    );

    expect(compiled.frontmatterFields).toEqual([
      { key: "title", value: "你好" },
      { key: "tags", value: "a · b" },
    ]);
    expect(compiled.body).toBe("# 正文");
    expect(compiled.bodyStartLine).toBe(6);
  });

  it("lineMap 恒等(不做数学归一化改写)", () => {
    const compiled = compileFileMarkdownDocument(
      "file:/a/math.md",
      ["# Math", "", "$$\\sum_{i=1}^{n} i$$", "", "target paragraph"].join("\n"),
    );

    expect(compiled.lineMap).toEqual([1, 2, 3, 4, 5]);
  });

  it("重块(>20 个 mermaid/math)触发 progressive 策略", () => {
    const rawMarkdown = Array.from({ length: 24 }, (_, index) => [
      "```mermaid",
      `graph TD\nA${index}-->B${index}`,
      "```",
    ].join("\n")).join("\n\n");

    const compiled = compileFileMarkdownDocument("file:/a/heavy.md", rawMarkdown);

    expect(compiled.metrics.heavyBlockCount).toBeGreaterThan(20);
    expect(compiled.renderStrategy).toBe("progressive");
  });

  it("围栏代码块与表格切块时不拆散", () => {
    const compiled = compileFileMarkdownDocument(
      "file:/a/blocks.md",
      [
        "# Title",
        "",
        "```ts",
        "const a = 1;",
        "const b = 2;",
        "```",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    expect(compiled.blocks.map((block) => block.markdown)).toEqual([
      "# Title",
      "```ts\nconst a = 1;\nconst b = 2;\n```",
      "| A | B |\n| - | - |\n| 1 | 2 |",
    ]);
    expect(compiled.blocks[1]).toMatchObject({ startLine: 3, endLine: 6 });
    expect(compiled.blocks[2]).toMatchObject({ startLine: 8, endLine: 10 });
  });

  it("有状态结构(列表/引用)保持原子,纯散文按 80 行切片", () => {
    const orderedList = Array.from({ length: 100 }, (_, index) => `${index + 1}. item ${index + 1}`)
      .join("\n");
    const plainProse = Array.from({ length: 100 }, (_, index) => `plain line ${index + 1}`)
      .join("\n");
    const blocks = segmentMarkdownDocumentBlocks([
      orderedList,
      "",
      "> quote line 1",
      "> quote line 2",
      "",
      plainProse,
    ].join("\n"));

    expect(blocks[0]?.markdown).toBe(orderedList);
    expect(blocks[1]?.markdown).toBe("> quote line 1\n> quote line 2");
    expect(blocks.slice(2).map((block) => block.markdown.split("\n").length)).toEqual([80, 20]);
  });

  it("识别无 leading pipe 的 GFM 表格", () => {
    const blocks = segmentMarkdownDocumentBlocks([
      "A | B",
      "--- | ---",
      "1 | 2",
      "3 | 4",
    ].join("\n"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.markdown).toBe("A | B\n--- | ---\n1 | 2\n3 | 4");
  });
});
