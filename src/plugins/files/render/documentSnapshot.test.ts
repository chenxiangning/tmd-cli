/**
 * 文档快照契约测试 —— 移植 codemoss fileDocumentSnapshot.test.ts 核心用例。
 * 覆盖:行数/行取文/CRLF 行界/UTF-8 字节数/空串/越界行。
 */

import { describe, expect, it } from "vitest";
import { createFileDocumentSnapshot } from "./documentSnapshot";

describe("createFileDocumentSnapshot", () => {
  it("空串:0 字节 0 行,hash 为 \"0\"", () => {
    const snapshot = createFileDocumentSnapshot("", false, 0);
    expect(snapshot.byteLength).toBe(0);
    expect(snapshot.lineCount).toBe(0);
    expect(snapshot.contentHash).toBe("0");
    expect(snapshot.getLineText(0)).toBe("");
  });

  it("LF 行界:getLineText 按 /n 切", () => {
    const snapshot = createFileDocumentSnapshot("alpha\nbeta\ngamma", false, 1);
    expect(snapshot.lineCount).toBe(3);
    expect(snapshot.getLineText(0)).toBe("alpha");
    expect(snapshot.getLineText(1)).toBe("beta");
    expect(snapshot.getLineText(2)).toBe("gamma");
    expect(snapshot.getLines(1, 3)).toEqual(["beta", "gamma"]);
  });

  it("CRLF 行界:行文不含 /r", () => {
    const snapshot = createFileDocumentSnapshot("one\r\ntwo\r\n", false, 0);
    expect(snapshot.lineCount).toBe(3);
    expect(snapshot.getLineText(0)).toBe("one");
    expect(snapshot.getLineText(1)).toBe("two");
    expect(snapshot.getLineText(2)).toBe("");
    expect(snapshot.byteLength).toBe(10);
  });

  it("UTF-8 字节数:中文 3 字节/字,emoji 4 字节", () => {
    const cjk = createFileDocumentSnapshot("中文", false, 0);
    expect(cjk.byteLength).toBe(6);
    const emoji = createFileDocumentSnapshot("😀", false, 0);
    expect(emoji.byteLength).toBe(4);
  });

  it("越界行:getLineText 空串 / getLineRange null / getLines 夹取", () => {
    const snapshot = createFileDocumentSnapshot("a\nb", false, 0);
    expect(snapshot.getLineText(-1)).toBe("");
    expect(snapshot.getLineText(99)).toBe("");
    expect(snapshot.getLineRange(99)).toBeNull();
    expect(snapshot.getLines(-5, 99)).toEqual(["a", "b"]);
  });

  it("truncated/snapshotVersion 原样透传", () => {
    const snapshot = createFileDocumentSnapshot("x", true, 7);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.snapshotVersion).toBe(7);
  });
});
