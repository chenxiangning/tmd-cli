/** lineMarksFromPatch 纯函数校验:纯增段=add、含删段=mod、删行锚定后继行、
 *  文件首删夹回行 1、文件尾删夹回总行数、\\ 行不推进计数、元数据头跳过。 */
import { describe, expect, it } from "vitest";
import { lineMarksFromPatch } from "./editorDiffGutter";

const HEADER = "diff --git a/f b/f\nindex 111..222 100644\n--- a/f\n+++ b/f\n";

describe("lineMarksFromPatch", () => {
  it("纯新增段标 add", () => {
    const patch = `${HEADER}@@ -1,2 +1,4 @@\n ctx1\n+new1\n+new2\n ctx2`;
    expect(lineMarksFromPatch(patch)).toEqual([
      { line: 2, kind: "add" },
      { line: 3, kind: "add" },
    ]);
  });

  it("同段含删的新增行标 mod,删除锚定后继行", () => {
    const patch = `${HEADER}@@ -1,3 +1,3 @@\n ctx1\n-old\n+new\n ctx2`;
    expect(lineMarksFromPatch(patch)).toEqual([
      { line: 2, kind: "mod" },
      { line: 2, kind: "del" },
    ]);
  });

  it("文件首删锚夹回行 1", () => {
    const patch = `${HEADER}@@ -1,2 +0,0 @@\n-gone1\n-gone2`;
    expect(lineMarksFromPatch(patch)).toEqual([{ line: 1, kind: "del" }]);
  });

  it("文件尾删锚夹回总行数", () => {
    const patch = `${HEADER}@@ -1,2 +1,1 @@\n ctx1\n-tail`;
    expect(lineMarksFromPatch(patch)).toEqual([{ line: 1, kind: "del" }]);
  });

  it("\\ No newline 行不推进新行号", () => {
    const patch = `${HEADER}@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file`;
    expect(lineMarksFromPatch(patch)).toEqual([
      { line: 1, kind: "mod" },
      { line: 1, kind: "del" },
    ]);
  });

  it("多 hunk 各自独立计数", () => {
    const patch = `${HEADER}@@ -1,1 +1,2 @@\n+a\n x\n@@ -10,1 +11,1 @@\n-b\n+c`;
    expect(lineMarksFromPatch(patch)).toEqual([
      { line: 1, kind: "add" },
      { line: 11, kind: "mod" },
      { line: 11, kind: "del" },
    ]);
  });
});
