/** 文章 md 解析测试(契约见 articleParse.ts 头注)。 */
import { describe, expect, it } from "vitest";
import { noteMd, parseArticle } from "./articleParse";

const FULL = `# 会话查看器渲染补齐 · 0.2.5 发布收尾

今日围绕会话查看器渲染能力补齐与 0.2.5 发布收尾,总览一段。

## 会话查看器 mermaid 渲染

markdownBody pre 分发复用现成组件。

## KaTeX 数学渲染补齐(11:47 并入)

remark-math + 条件 rehype-katex。

## 未完事项

- P1 ClawHub slug 净化
- 分架构 dmg 回归
`;

describe("parseArticle", () => {
  it("完整文章:标题/总览/分节(含并入留痕)/未完事项", () => {
    const a = parseArticle(FULL)!;
    expect(a.title).toBe("会话查看器渲染补齐 · 0.2.5 发布收尾");
    expect(a.lede).toContain("总览一段");
    expect(a.secs).toHaveLength(2);
    expect(a.secs[0].title).toBe("会话查看器 mermaid 渲染");
    expect(a.secs[0].inc).toBeUndefined();
    expect(a.secs[1].title).toBe("KaTeX 数学渲染补齐");
    expect(a.secs[1].inc).toBe("11:47");
    expect(a.open).toEqual(["P1 ClawHub slug 净化", "分架构 dmg 回归"]);
  });

  it("代码围栏内的 # 不当标题", () => {
    const a = parseArticle("# T\n\n## S\n\n```md\n# 假标题\n```\n尾行")!;
    expect(a.secs[0].body.join("\n")).toContain("# 假标题");
    expect(a.secs).toHaveLength(1);
  });

  it("无节无总览只有标题 → 有 lede 空串也接受(有 title 即成型)", () => {
    const a = parseArticle("# 只有标题\n\n一段总览。")!;
    expect(a.secs).toHaveLength(0);
    expect(a.lede).toBe("一段总览。");
  });

  it("空文本/无 h1 → null(按文章不存在处理)", () => {
    expect(parseArticle("")).toBeNull();
    expect(parseArticle("## 只有节没有 h1")).toBeNull();
    expect(parseArticle("随便一段文字")).toBeNull();
  });

  it("未完事项别名与中英混写均识别", () => {
    const a = parseArticle("# T\n总览\n\n## Open items\n- a")!;
    expect(a.open).toEqual(["a"]);
  });

  it("noteMd 单换行转硬断,连续空行保持段落边界,单行原样", () => {
    expect(noteMd("甲\n乙")).toBe("甲  \n乙");
    expect(noteMd("甲\n\n乙")).toBe("甲\n\n乙");
    expect(noteMd("只有一行")).toBe("只有一行");
  });
});
