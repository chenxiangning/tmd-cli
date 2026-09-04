/**
 * parsePatch 契约:首个 @@ 前的元数据头整段丢弃(噪音清理);
 * 正文按 unified 语义分类,以 +/-/@@ 开头的代码内容行不受误伤;
 * 多 hunk 各自成条;\ No newline 保留为 meta;空 patch 安全;
 * 无 @@ 的 patch(纯 mode/子模块)整段 meta 呈现,不留空白。
 */

import { describe, expect, it } from "vitest";
import { parsePatch } from "./PatchLines";

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
      text: "@@ -92,6 +92,36 @@ pub fn checkout(repo: &Repository) {",
    });
    const texts = rows.map((r) => r.text);
    for (const noise of ["diff --git", "index ", "--- ", "+++ "]) {
      expect(texts.some((t) => t.startsWith(noise))).toBe(false);
    }
    expect(rows).toHaveLength(8); // 2 hunk + 6 正文(尾随空行残影已去)
  });

  it("正文 +/-/上下文/\ No newline 分类正确", () => {
    const rows = parsePatch(PATCH);
    expect(rows[1]).toMatchObject({ kind: "ctx", text: "     Ok(())" });
    expect(rows[2]).toMatchObject({ kind: "add", text: "+let name = name.trim();" });
    expect(rows[3]).toMatchObject({ kind: "del", text: "-let old = 1;" });
    expect(rows[4]).toMatchObject({ kind: "meta", text: "\\ No newline at end of file" });
  });

  it("以 @@ 开头的 hunk 行各自成条,不吞并后续正文", () => {
    const rows = parsePatch(PATCH);
    expect(rows[5]).toMatchObject({ kind: "hunk", text: "@@ -130,7 +160,7 @@ fn create() {" });
    expect(rows[6]).toMatchObject({ kind: "add", text: "+    second();" });
    expect(rows[7]).toMatchObject({ kind: "ctx", text: " context();" });
  });

  it("正文里 +++/--- 开头的代码内容行按 +/- 着色,不当元数据丢掉", () => {
    const rows = parsePatch("@@ -1,1 +1,2 @@\n context\n+++ triple\n--- gone\n");
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "ctx", "add", "del"]);
  });

  it("空串返回空;无 @@ 的 patch(纯头/mode 变更)整段 meta 呈现,不留空白", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parsePatch("diff --git a/b\n")).toEqual([
      { kind: "meta", text: "diff --git a/b" },
    ]);
    expect(parsePatch("old mode 100644\nnew mode 100755\n").map((r) => r.kind)).toEqual([
      "meta",
      "meta",
    ]);
  });
});
