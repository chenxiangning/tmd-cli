/**
 * symRange 测试 —— wrapSymRange 契约清单:
 * 1. 守卫:start<0 / end<=start / start 非有限 → 原样返回;start 越过文尾不包裹
 * 2. 纯文本:区间包裹、起点 0、end 越过文尾闭到尾
 * 3. token 内切分:闭栈拆 token 重开,嵌套配对无游离闭标签,后续 token 不掉色
 * 4. 跨 token 区间:sym 横跨原始闭/开标签,重开序与栈配对
 * 5. 实体:&lt; 等转义各记 1 个解码字符,偏移按解码后文本计
 */
import { describe, expect, it } from "vitest";

import { wrapSymRange } from "./symRange";

const SYM = '<span class="lsp-peek-sym">';

describe("守卫", () => {
  it("start<0 / end<=start / 非有限 start 原样返回", () => {
    expect(wrapSymRange("abc", -1, 2)).toBe("abc");
    expect(wrapSymRange("abc", 2, 2)).toBe("abc");
    expect(wrapSymRange("abc", 3, 1)).toBe("abc");
    expect(wrapSymRange("abc", Number.NaN, 2)).toBe("abc");
  });

  it("start 越过文尾不包裹", () => {
    expect(wrapSymRange("abc", 5, 9)).toBe("abc");
  });
});

describe("纯文本", () => {
  it("区间包裹与起点 0", () => {
    expect(wrapSymRange("hello world", 6, 11)).toBe(`hello ${SYM}world</span>`);
    expect(wrapSymRange("hello", 0, 2)).toBe(`${SYM}he</span>llo`);
  });

  it("end 越过文尾闭到尾", () => {
    expect(wrapSymRange("hi", 1, 99)).toBe(`h${SYM}i</span>`);
  });
});

describe("token 内切分", () => {
  const KW = '<span class="token keyword">';

  it("开闭边界同在一个 token 内:拆三段,后续文本保色", () => {
    const html = `${KW}constant</span>`;
    expect(wrapSymRange(html, 2, 5)).toBe(
      `${KW}co</span>${SYM}${KW}nst</span></span>${KW}ant</span>`,
    );
  });

  it("Prism 嵌套 token:栈式闭全重开保持配对", () => {
    const html = '<span class="token string"><span class="token inner">abcd</span></span>';
    expect(wrapSymRange(html, 1, 3)).toBe(
      '<span class="token string"><span class="token inner">a</span></span>' +
        SYM +
        '<span class="token string"><span class="token inner">bc</span></span></span>' +
        '<span class="token string"><span class="token inner">d</span></span>',
    );
  });
});

describe("跨 token 区间", () => {
  it("sym 横跨原始闭/开标签:重开序与栈配对,无游离闭标签", () => {
    const html = '<span class="token keyword">const</span> x';
    /* "nst x":跨 KW 闭标签,sym 内纯文本段不裹 token */
    expect(wrapSymRange(html, 2, 7)).toBe(
      '<span class="token keyword">co</span>' +
        SYM +
        '<span class="token keyword">nst</span> x</span>',
    );
  });
});

describe("实体", () => {
  it("&lt; 等转义各记 1 个解码字符", () => {
    /* 解码后 "<div>":偏移 0..5 覆盖全部 */
    expect(wrapSymRange("&lt;div&gt;", 0, 5)).toBe(`${SYM}&lt;div&gt;</span>`);
    /* 解码后 "a<b"(3 字符):偏移 1..2 恰包裹 "<" 一个实体 */
    expect(wrapSymRange("a&lt;b", 1, 2)).toBe(`a${SYM}&lt;</span>b`);
  });

  it("区间越过实体文尾闭到尾", () => {
    expect(wrapSymRange("&amp;&lt;", 1, 9)).toBe(`&amp;${SYM}&lt;</span>`);
  });
});
