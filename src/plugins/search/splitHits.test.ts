import { describe, expect, it } from "vitest";
import { splitHits } from "./splitHits";

describe("splitHits 行切段", () => {
  it("常规不区分大小写:命中段精确", () => {
    const parts = splitHits("Foo BAR foo", "foo", false);
    expect(parts).toEqual([
      { text: "Foo", hit: true },
      { text: " BAR ", hit: false },
      { text: "foo", hit: true },
    ]);
  });

  it("无命中整行一段", () => {
    expect(splitHits("abc", "zz", false)).toEqual([{ text: "abc", hit: false }]);
  });

  it("lower 变长字符(İ):索引不错位、原文恒准", () => {
    /* İ.toLowerCase() = "i̇"(2 字符)→ 快路径失效走 RegExp;旧实现会把
     * 段切错(hay 索引用于原文)。此处断言 i 命中段就是原文里的 "i"。 */
    const parts = splitHits("İa i b", "i", false);
    expect(parts).toEqual([
      { text: "İa ", hit: false },
      { text: "i", hit: true },
      { text: " b", hit: false },
    ]);
  });

  it("正则元字符 query 不炸且按字面命中", () => {
    const parts = splitHits("a.b axb", "a.b", false);
    expect(parts).toEqual([
      { text: "a.b", hit: true },
      { text: " axb", hit: false },
    ]);
  });
});
