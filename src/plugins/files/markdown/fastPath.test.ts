/**
 * 快路径契约测试 —— fastPath.ts(yn 行为复刻面)。
 * 覆盖:常规块 HTML 结构(标题/表格/删除线/自动链接/任务列表/代码块包装)、
 * 富块分类(mermaid/数学/raw HTML 命中,常规块不命中)、链接三分流属性、
 * 内容级缓存、html:false 转义(快路径零 XSS 面)。
 */
import { afterEach, describe, expect, it } from "vitest";
import { clearFastPathCacheForTests, isRichBlock, renderFastMarkdown } from "./fastPath";

describe("fastPath renderFastMarkdown", () => {
  afterEach(() => {
    clearFastPathCacheForTests();
  });

  it("常规块产出基础结构(标题/段落/表格滚动包裹/删除线)", () => {
    const html = renderFastMarkdown("# 标题\n\n段落 **加粗** ~~删除~~\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<s>删除</s>");
    expect(html).toContain('<div class="fvp-file-markdown-table-wrap"><table>');
    expect(html).toContain("</table></div>");
  });

  it("代码块:语言徽标 + 复制按钮 + prism 高亮 code", () => {
    const html = renderFastMarkdown("```ts\nconst x = 1;\n```");
    expect(html).toContain('class="fvp-file-markdown-codeblock"');
    expect(html).toContain('<span class="markdown-codeblock-language-text">ts</span>');
    expect(html).toContain("data-md-copy");
    expect(html).toContain('class="language-ts"');
    expect(html).toContain("token");
  });

  it("任务列表:checkbox + task-list-item 类", () => {
    const html = renderFastMarkdown("- [ ] 待办\n- [x] 已办");
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('<input type="checkbox" disabled class="tmd-task-checkbox">');
    expect(html).toContain('<input type="checkbox" disabled checked class="tmd-task-checkbox">');
    expect(html).toContain("待办");
  });

  it("链接三分流:外链/锚点/本地文件各打 data 属性", () => {
    const html = renderFastMarkdown(
      "[官网](https://example.com/a?b=1) [章](#section) [文档](./readme.md)",
      "/ws/proj/docs/index.md",
    );
    expect(html).toContain('data-md-link="external" href="https://example.com/a?b=1"');
    expect(html).toContain('data-md-link="anchor" data-md-anchor="section"');
    expect(html).toContain('data-md-link="file" data-md-path="/ws/proj/docs/readme.md"');
  });

  it("危险协议链接不产出 <a>(markdown-it validateLink 兜底,优于 dead 分支)", () => {
    const html = renderFastMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript');
  });

  it("html:false 转义一切原文(快路径零 XSS 面)", () => {
    const html = renderFastMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain("&lt;img");
  });

  it("同内容命中缓存(返回同一字符串引用)", () => {
    const first = renderFastMarkdown("# 同\n\n内容", "/ws/a.md");
    const second = renderFastMarkdown("# 同\n\n内容", "/ws/a.md");
    expect(second).toBe(first);
  });
});

describe("fastPath isRichBlock", () => {
  it("mermaid / 数学栅栏 / 数学定界 / raw HTML 命中富路径", () => {
    expect(isRichBlock("```mermaid\ngraph TD\n```")).toBe(true);
    expect(isRichBlock("```math\nx^2\n```")).toBe(true);
    expect(isRichBlock("行内 $a+b$ 数学")).toBe(true);
    expect(isRichBlock("$$\nblock math\n$$")).toBe(true);
    expect(isRichBlock("前置\n\n<div class=\"x\">hi</div>")).toBe(true);
  });

  it("脚注定义命中富路径(markdown-it 无脚注语义,须落 remark-gfm)", () => {
    expect(isRichBlock("正文。[^1]\n\n[^1]: 脚注说明")).toBe(true);
    expect(isRichBlock("段落\n\n[^a]: 定义\n  续行")).toBe(true);
    expect(isRichBlock("普通 [链接] 与引用")).toBe(false);
  });

  it("引用/列表内嵌的 math/mermaid 栅栏也命中富路径(P2 评审项)", () => {
    expect(isRichBlock("> ```math\n> x^2\n> ```")).toBe(true);
    expect(isRichBlock("- ```mermaid\n  graph TD\n  ```")).toBe(true);
    expect(isRichBlock("1. ```latex\n   a\n   ```")).toBe(true);
    expect(isRichBlock("> 引用里的普通 ```ts 代码")).toBe(false);
  });

  it("常规内容与普通代码块走快路径", () => {
    expect(isRichBlock("# 标题\n\n段落")).toBe(false);
    expect(isRichBlock("```ts\nconst x = 1;\n```")).toBe(false);
    expect(isRichBlock("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(false);
    expect(isRichBlock("价格 $100 与 $200 美元")).toBe(false);
  });
});
