/**
 * LSP 位置换算管道测试 —— lspLocations 契约清单:
 * 1. normalizeLocations:null/undefined → 空;单个 Location 包一成数组;数组保序;
 *    LocationLink(targetUri/targetRange)归一;非对象/缺 uri/缺 range/uri 非字符串项剔除
 * 2. uriToPath:剥 file:// 前缀、仅对 file:// 解码 %XX(裸路径不解码,非法 % 序列不抛)、反斜杠与尾分隔符归一
 * 3. locToPeekItem:0 基行 → 1 基;同行 end → endChar;跨行 endChar=null
 * 4. rangeContainsOffset:两端闭区间;跨行区间含换行偏移;越界行列收拢到行尾/文档尾后判定
 */
import { describe, expect, it } from "vitest";

import { locToPeekItem, normalizeLocations, rangeContainsOffset, uriToPath } from "./lspLocations";
import type { LspRange } from "@kernel/lsp/lspPosition";

const range = (sl: number, sc: number, el: number, ec: number): LspRange => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

describe("normalizeLocations(归一)", () => {
  it("null/undefined/空数组 → 空列表", () => {
    expect(normalizeLocations(null)).toEqual([]);
    expect(normalizeLocations(undefined)).toEqual([]);
    expect(normalizeLocations([])).toEqual([]);
  });

  it("单个 Location 对象包一成数组", () => {
    const raw = { uri: "file:///a.ts", range: range(0, 0, 0, 3) };
    expect(normalizeLocations(raw)).toEqual([{ uri: "file:///a.ts", range: range(0, 0, 0, 3) }]);
  });

  it("LocationLink 归一为 targetUri + targetRange,忽略其余字段", () => {
    const raw = {
      targetUri: "file:///b.ts",
      targetRange: range(1, 2, 1, 5),
      targetSelectionRange: range(1, 4, 1, 5),
    };
    expect(normalizeLocations(raw)).toEqual([{ uri: "file:///b.ts", range: range(1, 2, 1, 5) }]);
  });

  it("数组保序且逐项归一", () => {
    const raw = [
      { uri: "file:///a.ts", range: range(0, 0, 0, 1) },
      { targetUri: "file:///b.ts", targetRange: range(9, 0, 9, 1) },
    ];
    const out = normalizeLocations(raw);
    expect(out.map((loc) => loc.uri)).toEqual(["file:///a.ts", "file:///b.ts"]);
  });

  it("非法项剔除:非对象、缺 uri、缺 range、uri 非字符串", () => {
    const raw = [
      42,
      "file:///x.ts",
      null,
      { range: range(0, 0, 0, 1) },
      { uri: 7, range: range(0, 0, 0, 1) },
      { uri: "file:///ok.ts" },
      { uri: "file:///ok.ts", range: "bad" },
    ];
    expect(normalizeLocations(raw)).toEqual([]);
  });
});

describe("uriToPath", () => {
  it("剥 file:// 前缀并解码 %XX", () => {
    expect(uriToPath("file:///a/b%20c.ts")).toBe("/a/b c.ts");
  });
  it("裸路径不解码:字面 % 序列原样保留(合法 %XX 也不误解码)", () => {
    expect(uriToPath("w/50%20off.md")).toBe("w/50%20off.md");
    expect(uriToPath("w/src/a.ts")).toBe("w/src/a.ts");
  });
  it("file:// 含非法 % 序列 → 不抛 URIError,按未解码原样回落", () => {
    expect(uriToPath("file:///a/50%off.md")).toBe("/a/50%off.md");
  });

  it("无转义裸路径原样透传", () => {
    expect(uriToPath("w/src/a.ts")).toBe("w/src/a.ts");
  });

  it("反斜杠归一为正斜杠并去掉尾分隔符", () => {
    /* file:// 剥前缀后保留前导 /,Windows 盘符路径实得 /C:/ 前缀(现状契约)。 */
    expect(uriToPath("file:///C:%5Ca%5Cb.ts")).toBe("/C:/a/b.ts");
    expect(uriToPath("file:///w/src/")).toBe("/w/src");
  });
});

describe("locToPeekItem", () => {
  it("0 基行转 1 基,同行 end 保留为 endChar", () => {
    expect(locToPeekItem({ uri: "file:///a.ts", range: range(3, 5, 3, 9) })).toEqual({
      path: "/a.ts",
      line: 4,
      startChar: 5,
      endChar: 9,
    });
  });

  it("跨行符号 endChar=null(高亮到行尾)", () => {
    const item = locToPeekItem({ uri: "file:///a.ts", range: range(3, 0, 4, 6) });
    expect(item.line).toBe(4);
    expect(item.endChar).toBeNull();
  });
});

describe("rangeContainsOffset", () => {
  const doc = "ab\ncd\nef";

  it("同行区间两端闭区间:界内含、界外不含", () => {
    const r = range(0, 0, 0, 2); // "ab" → 偏移 [0,2]
    expect(rangeContainsOffset(r, doc, 0)).toBe(true);
    expect(rangeContainsOffset(r, doc, 2)).toBe(true);
    expect(rangeContainsOffset(r, doc, 3)).toBe(false);
  });

  it("跨行区间包含换行偏移与末行界内偏移", () => {
    const r = range(0, 1, 2, 1); // 偏移 [1,7],涵盖两个换行(2、5)
    expect(rangeContainsOffset(r, doc, 2)).toBe(true);
    expect(rangeContainsOffset(r, doc, 5)).toBe(true);
    expect(rangeContainsOffset(r, doc, 7)).toBe(true);
    expect(rangeContainsOffset(r, doc, 8)).toBe(false);
  });

  it("越界列收拢到行尾后再判定", () => {
    // end.character 99 收拢到第 0 行行尾(偏移 2)
    const r = range(0, 0, 0, 99);
    expect(rangeContainsOffset(r, doc, 2)).toBe(true);
    expect(rangeContainsOffset(r, doc, 3)).toBe(false);
  });

  it("越界行收拢到文档尾(偏移 = 文档长)", () => {
    const r = range(0, 0, 99, 0);
    expect(rangeContainsOffset(r, doc, doc.length)).toBe(true);
  });
});
