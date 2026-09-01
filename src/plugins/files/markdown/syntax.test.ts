/**
 * Prism 高亮器契约测试 —— 照抄 codemoss syntax 行为要点。
 * 覆盖:已知语言产出 token span、未知语言 HTML 转义直出、
 * LRU 缓存命中返回同一引用(dangerouslySetInnerHTML 消费方跳过 DOM 重写)。
 */
import { describe, expect, it } from "vitest";
import { highlightLine } from "./syntax";

describe("highlightLine", () => {
  it("已知语言产出 Prism token 标记", () => {
    const html = highlightLine("const a = 1;", "typescript");
    expect(html).toContain('class="token keyword"');
    expect(html).toContain("const");
  });

  it("未知语言/空语言 → HTML 转义直出", () => {
    expect(highlightLine("<b>x</b>", null)).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(highlightLine("<b>x</b>", "not-a-lang")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });

  it("缓存命中返回同一字符串引用", () => {
    const first = highlightLine("fn main() {}", "rust");
    const second = highlightLine("fn main() {}", "rust");
    expect(second).toBe(first);
  });

  it("输出不含事件处理器属性(sanitize 防御)", () => {
    const html = highlightLine("const a = 1;", "javascript");
    expect(html).not.toMatch(/\son\w+=/i);
  });
});
