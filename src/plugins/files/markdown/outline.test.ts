/**
 * markdown 章节大纲提取契约测试。
 * 覆盖:ATX 标题层级树、围栏内 # 注释不误判、引用块内标题不收、
 * 锚点 id 唯一性、flatten 先根后序。
 */
import { describe, expect, it } from "vitest";
import {
  extractMarkdownOutline,
  flattenPreviewOutlineItems,
} from "./outline";

describe("extractMarkdownOutline", () => {
  it("按层级建树(h1 > h2 > h2 同级)", () => {
    const outline = extractMarkdownOutline(
      ["# A", "", "## A.1", "", "### A.1.1", "", "## A.2", "", "# B"].join("\n"),
    );

    expect(outline.map((i) => i.title)).toEqual(["A", "B"]);
    expect(outline[0]?.children.map((i) => i.title)).toEqual(["A.1", "A.2"]);
    expect(outline[0]?.children[0]?.children[0]?.title).toBe("A.1.1");
    expect(outline[0]?.children[0]?.children[0]?.level).toBe(3);
  });

  it("围栏代码块内的 # 注释不进大纲", () => {
    const outline = extractMarkdownOutline(
      ["# 真标题", "", "```bash", "# 这是注释", "```", "", "## 次标题"].join("\n"),
    );

    expect(flattenPreviewOutlineItems(outline).map((i) => i.title)).toEqual([
      "真标题",
      "次标题",
    ]);
  });

  it("引用块内标题不进大纲", () => {
    const outline = extractMarkdownOutline(
      ["# 真标题", "", "> # 引用里的标题", "", "正文"].join("\n"),
    );

    expect(flattenPreviewOutlineItems(outline)).toHaveLength(1);
  });

  it("空文档/无标题返回空表", () => {
    expect(extractMarkdownOutline("")).toEqual([]);
    expect(extractMarkdownOutline("纯文本\n\n没有标题")).toEqual([]);
  });

  it("锚点 id 全局唯一且携带源码行号", () => {
    const outline = extractMarkdownOutline(
      ["# A", "", "# A", "", "## B"].join("\n"),
    );
    const flat = flattenPreviewOutlineItems(outline);
    const ids = flat.map((i) => i.target.anchorId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(flat[1]?.target.sourceStartLine).toBe(3);
  });

  it("flatten 先根先序", () => {
    const outline = extractMarkdownOutline(
      ["# A", "## A.1", "# B"].join("\n"),
    );
    expect(flattenPreviewOutlineItems(outline).map((i) => i.title)).toEqual([
      "A",
      "A.1",
      "B",
    ]);
  });
});
