import { describe, expect, it } from "vitest";
import { lspToOffset, offsetToLsp } from "./lspPosition";

describe("lspToOffset(UTF-16 单位系,与 CM Text 同)", () => {
  it("ASCII 直位与行首", () => {
    expect(lspToOffset("const x = 1;", { line: 0, character: 6 })).toBe(6);
    expect(lspToOffset("ab\ncd\nef", { line: 1, character: 0 })).toBe(3);
    expect(lspToOffset("ab\ncd\nef", { line: 2, character: 1 })).toBe(7);
  });

  it("astral 字符按 UTF-16 计两单位(与 CM6 doc.length 实证一致)", () => {
    // "a😀b":单位长 4;😀 占列 1-2
    expect(lspToOffset("a😀b", { line: 0, character: 3 })).toBe(3);
    expect(lspToOffset("😀😀", { line: 0, character: 2 })).toBe(2);
  });

  it("行/列越界收拢(防御坏应答)", () => {
    expect(lspToOffset("ab\ncd", { line: 9, character: 0 })).toBe(5);
    expect(lspToOffset("ab", { line: 0, character: 99 })).toBe(2);
    expect(lspToOffset("ab\ncd", { line: 1, character: 99 })).toBe(5);
  });
});

describe("offsetToLsp / 往返", () => {
  it("多行与 CJK/emoji 混排全偏移往返恒等", () => {
    const text = 'const 名字 = "😀x";\n第二行(y)\n';
    for (let offset = 0; offset <= text.length; offset++) {
      expect(lspToOffset(text, offsetToLsp(text, offset))).toBe(offset);
    }
  });

  it("换行计数与行内列", () => {
    expect(offsetToLsp("ab\ncd", 3)).toEqual({ line: 1, character: 0 });
    expect(offsetToLsp("a😀\nz", 2)).toEqual({ line: 0, character: 2 });
  });
});

