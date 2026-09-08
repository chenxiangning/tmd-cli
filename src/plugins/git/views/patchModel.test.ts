/**
 * patchModel 契约:
 * parsePatch —— 首个 @@ 前的元数据头整段丢弃(噪音清理);@@ 头播种行号,
 * ctx 双增 / del 旧增 / add 新增;+/-/空格 前缀剥除(语义由行号与底色承担);
 * \ No newline 保留为 meta;空 patch 安全;
 * 无 @@ 的 patch(纯 mode/子模块)整段 meta 呈现,不留空白。
 * buildSplitRows —— ctx 左右同源;del 块 × 紧随 add 块按下标配对;
 * 余量侧 null(渲染期斜纹占位);hunk/meta 成 header 通栏行。
 */

import { describe, expect, it } from "vitest";
import { buildSplitRows, parsePatch } from "./patchModel";

const PATCH = [
  "diff --git a/src/x.rs b/src/x.rs",
  "index ba03d63..a29957 100644",
  "--- a/src/x.rs",
  "+++ b/src/x.rs",
  "@@ -92,6 +92,36 @@ pub fn checkout(repo: &Repository) {",
  "     Ok(())",
  "+let name = name.trim();",
  "-let old = 1;",
  "\\ No newline at end of file",
  "@@ -130,7 +160,7 @@ fn create() {",
  "+    second();",
  " context();",
  "",
].join("\n");

describe("parsePatch", () => {
  it("丢弃首个 @@ 前的全部元数据头,正文从第一个 hunk 开始", () => {
    const rows = parsePatch(PATCH);
    expect(rows[0]).toEqual({
      kind: "hunk",
      oldLine: null,
      newLine: null,
      text: "@@ -92,6 +92,36 @@ pub fn checkout(repo: &Repository) {",
    });
    const texts = rows.map((r) => r.text);
    for (const noise of ["diff --git", "index ", "--- ", "+++ "]) {
      expect(texts.some((t) => t.startsWith(noise))).toBe(false);
    }
    expect(rows).toHaveLength(8); // 2 hunk + 6 正文(尾随空行残影已去)
  });

  it("@@ 头播种行号:ctx 双增 / add 新增 / del 旧增,前缀剥除", () => {
    const rows = parsePatch(PATCH);
    expect(rows[1]).toEqual({ kind: "ctx", oldLine: 92, newLine: 92, text: "    Ok(())" });
    expect(rows[2]).toEqual({ kind: "add", oldLine: null, newLine: 93, text: "let name = name.trim();" });
    expect(rows[3]).toEqual({ kind: "del", oldLine: 93, newLine: null, text: "let old = 1;" });
    expect(rows[4]).toMatchObject({ kind: "meta", text: "\\ No newline at end of file" });
  });

  it("第二个 hunk 重新播种:后续行号从新起点计数", () => {
    const rows = parsePatch(PATCH);
    expect(rows[5]).toMatchObject({ kind: "hunk", text: "@@ -130,7 +160,7 @@ fn create() {" });
    expect(rows[6]).toEqual({ kind: "add", oldLine: null, newLine: 160, text: "    second();" });
    expect(rows[7]).toEqual({ kind: "ctx", oldLine: 130, newLine: 161, text: "context();" });
  });

  it("@@ 畸形头(combined @@@ 等)降级为 meta,不播种不沿用旧计数", () => {
    const rows = parsePatch("@@@ -1,2 -3,4 +5,6 @@@\n x\n@@ -1,1 +1,1 @@\n y\n");
    expect(rows[0]).toMatchObject({ kind: "meta", text: "@@@ -1,2 -3,4 +5,6 @@@" });
    // 未播种:畸形头与下一个合法 hunk 之间的行按头前噪音丢弃,不给假号
    expect(rows[1]).toMatchObject({ kind: "hunk" });
    expect(rows[2]).toMatchObject({ kind: "ctx", oldLine: 1, newLine: 1 });
    expect(rows).toHaveLength(3);
  });

  it("正文里 +++/--- 开头的代码内容行按 +/- 分类,不当元数据丢掉", () => {
    const rows = parsePatch("@@ -1,1 +1,2 @@\n context\n+++ triple\n--- gone\n");
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "ctx", "add", "del"]);
    expect(rows[2]).toMatchObject({ newLine: 2, text: "++ triple" });
    expect(rows[3]).toMatchObject({ oldLine: 2, text: "-- gone" });
  });

  it("空串返回空;无 @@ 的 patch(纯头/mode 变更)整段 meta 呈现,不留空白", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parsePatch("diff --git a/b\n")).toEqual([
      { kind: "meta", oldLine: null, newLine: null, text: "diff --git a/b" },
    ]);
    expect(parsePatch("old mode 100644\nnew mode 100755\n").map((r) => r.kind)).toEqual([
      "meta",
      "meta",
    ]);
  });
});

describe("buildSplitRows", () => {
  it("ctx 行左右同源(同一行对象),hunk/meta 成 header 通栏", () => {
    const rows = parsePatch(PATCH);
    const split = buildSplitRows(rows);
    expect(split[0]).toEqual({ kind: "header", row: rows[0] }); // hunk
    expect(split[1]).toEqual({ kind: "pair", left: rows[1], right: rows[1] }); // ctx 同源
    expect(split[4]).toEqual({ kind: "header", row: rows[4] }); // \ No newline meta
  });

  it("del 块 × 紧随 add 块按下标配对,余量侧 null", () => {
    const rows = parsePatch("@@ -10,3 +10,2 @@\n-a\n-b\n-c\n+x\n+y\n");
    const split = buildSplitRows(rows);
    expect(split.slice(1)).toEqual([
      { kind: "pair", left: rows[1], right: rows[4] },
      { kind: "pair", left: rows[2], right: rows[5] },
      { kind: "pair", left: rows[3], right: null },
    ]);
  });

  it("纯 add 块左侧留空;add 先行(del 块为空)不留对位错位", () => {
    const rows = parsePatch("@@ -10,0 +11,2 @@\n+x\n+y\n ctx\n");
    const split = buildSplitRows(rows);
    expect(split.slice(1)).toEqual([
      { kind: "pair", left: null, right: rows[1] },
      { kind: "pair", left: null, right: rows[2] },
      { kind: "pair", left: rows[3], right: rows[3] },
    ]);
  });

  it("纯 del 块右侧留空", () => {
    const rows = parsePatch("@@ -10,2 +10,0 @@\n-a\n-b\n");
    const split = buildSplitRows(rows);
    expect(split.slice(1)).toEqual([
      { kind: "pair", left: rows[1], right: null },
      { kind: "pair", left: rows[2], right: null },
    ]);
  });
  it("\\ No newline meta 夹在 del/add 块中间不拆配对,按原序补发为 header", () => {
    // 无尾换行文件改最后一行的标准 git 输出
    const rows = parsePatch(
      "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n",
    );
    const split = buildSplitRows(rows);
    expect(split[0]).toEqual({ kind: "header", row: rows[0] }); // hunk
    expect(split[1]).toEqual({ kind: "pair", left: rows[1], right: rows[1] }); // ctx
    expect(split[2]).toEqual({ kind: "pair", left: rows[2], right: rows[4] }); // -b × +c 对照
    expect(split[3]).toEqual({ kind: "header", row: rows[3] }); // meta 原序补发
    expect(split[4]).toEqual({ kind: "header", row: rows[5] });
  });
});

