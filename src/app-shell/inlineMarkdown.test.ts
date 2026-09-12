/**
 * inlineMarkdown 单元测试 —— 守住两个契约:
 * 1. 三种行内标记(`code` / **粗体** / [label](http url))正确分段,未匹配
 *    字符(含单反引号、javascript: 链接)原样保留为 text;
 * 2. 不变量:各 seg value 顺序拼接 === 原文(解析不吞字符)——并对打包内嵌的
 *    真实 CHANGELOG_ENTRIES 全量条目验证,防 tokenizer 吃字导致内容缺失。
 */
import { describe, expect, it } from "vitest";
import { parseInlineMarkdown } from "./inlineMarkdown";
import { CHANGELOG_ENTRIES } from "./updateCheck";

/** 重组:按 seg 类型补回标记符。解析不吞内容的充要表达。 */
const rebuilt = (text: string) =>
  parseInlineMarkdown(text)
    .map((s) =>
      s.type === "code"
        ? `\`${s.value}\``
        : s.type === "bold"
          ? `**${s.value}**`
          : s.type === "link"
            ? `[${s.value}](${s.href})`
            : s.value,
    )
    .join("");

describe("parseInlineMarkdown", () => {
  it("纯文本原样单段", () => {
    expect(parseInlineMarkdown("无任何标记的一行")).toEqual([
      { type: "text", value: "无任何标记的一行" },
    ]);
  });

  it("code / bold / link 各自成段", () => {
    expect(parseInlineMarkdown("前 `assistantStream` 中 **加粗** 后")).toEqual([
      { type: "text", value: "前 " },
      { type: "code", value: "assistantStream" },
      { type: "text", value: " 中 " },
      { type: "bold", value: "加粗" },
      { type: "text", value: " 后" },
    ]);
    expect(parseInlineMarkdown("见 [Releases](https://github.com/x/y/releases) 页")).toEqual([
      { type: "text", value: "见 " },
      { type: "link", value: "Releases", href: "https://github.com/x/y/releases" },
      { type: "text", value: " 页" },
    ]);
  });

  it("单反引号与非 http(s) 链接不匹配,原样为 text", () => {
    const raw = "路径 含 `~/.local/bin 与 javascript:alert(1) 与 [x](ftp://a)";
    expect(parseInlineMarkdown(raw).every((s) => s.type === "text" || s.type === "code")).toBe(
      true,
    );
  });

  it("不变量:按标记重组恒等于原文(解析只换语义不吞字)", () => {
    for (const raw of [
      "a`b`c**d**e[f](https://g)h",
      "``",
      "`未闭合 **粗体 [x](https://y)",
      "中文,标点:混排 `code`尾随无空格",
    ]) {
      expect(rebuilt(raw)).toBe(raw);
    }
  });

  it("真实 CHANGELOG 全量条目:重组无损", () => {
    expect(CHANGELOG_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of CHANGELOG_ENTRIES) {
      for (const block of entry.blocks) {
        for (const item of block.items) {
          expect(rebuilt(item)).toBe(item);
        }
      }
    }
  });
});
