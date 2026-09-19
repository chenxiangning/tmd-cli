/**
 * markdown 块分段契约测试 —— markdownBlockSegment.ts(主测)+ 同目录小模块并入:
 * markdownMath.ts(数学探测 / katex 懒加载降级 / 公式渲染解包)、languageTag.ts(语言标注解析)。
 * 覆盖:segmentMarkdownDocumentBlocks(空输入、栅栏变体与嵌套前缀栅栏、代码块内不误判、
 * 表格起止条件、任务/括号列表/缩进代码的原子性、1 基行号 key、CRLF)、
 * countMarkdownBlocks(段落按空行聚合、栅栏语言重块、表格重块、结构行计数)、
 * detectMathContent 四族定界符与转义边界、katex 未就绪降级与加载后定界解包等价、
 * extractLanguageTag 别名判别。与 markdownDocument.test.ts 不重场景(那边测编译器门面)。
 */
import { describe, expect, it } from "vitest";
import { countMarkdownBlocks, segmentMarkdownDocumentBlocks } from "./markdownBlockSegment";
import {
  areKatexAssetsReady,
  detectMathContent,
  getCachedRehypeKatex,
  loadKatexAssets,
  renderLatexFormula,
} from "./markdownMath";
import { extractLanguageTag } from "./languageTag";

describe("segmentMarkdownDocumentBlocks", () => {
  it("空输入与纯空白返回空数组", () => {
    expect(segmentMarkdownDocumentBlocks("")).toEqual([]);
    expect(segmentMarkdownDocumentBlocks("  \n \n")).toEqual([]);
  });

  it("波浪栅栏整块不拆,内部反引号行不闭合波浪栅栏", () => {
    const blocks = segmentMarkdownDocumentBlocks("~~~\n```inner\ntext\n~~~\nafter");
    expect(blocks.map((block) => block.markdown)).toEqual(["~~~\n```inner\ntext\n~~~", "after"]);
  });

  it("未闭合栅栏到文档末尾整块收尾,行号含尾", () => {
    const blocks = segmentMarkdownDocumentBlocks("a\n\n```ts\nconst x = 1;");
    expect(blocks.map((block) => block.markdown)).toEqual(["a", "```ts\nconst x = 1;"]);
    expect(blocks[1]).toMatchObject({ startLine: 3, endLine: 4 });
  });

  it("引用/列表前缀的嵌套栅栏不按栅栏切块,随宿主引用/列表保持原子", () => {
    // 切块器 trim 不剥 >/- 前缀:嵌套栅栏整段落只保原子性;栅栏识别由 fastPath 富路径负责
    const blocks = segmentMarkdownDocumentBlocks("前言\n\n> ```math\n> x^2\n> ```\n\n尾段");
    expect(blocks.map((block) => block.markdown)).toEqual([
      "前言",
      "> ```math\n> x^2\n> ```",
      "尾段",
    ]);
  });

  it("代码块内表格行/空行/井号行不触发切块,块外表格正常切出", () => {
    const blocks = segmentMarkdownDocumentBlocks(
      "```ts\n| a | b |\n# not heading\n\nconst x = 1;\n```\n| A | B |\n| --- | --- |",
    );
    expect(blocks.map((block) => block.markdown)).toEqual([
      "```ts\n| a | b |\n# not heading\n\nconst x = 1;\n```",
      "| A | B |\n| --- | --- |",
    ]);
  });

  it("缺定界行的竖线散文不触发表格切分,对齐定界行可起表并在非候选行终止", () => {
    const prose = segmentMarkdownDocumentBlocks("a | b\nc | d");
    expect(prose.map((block) => block.markdown)).toEqual(["a | b\nc | d"]);

    const table = segmentMarkdownDocumentBlocks("| a | b |\n| :--- | ---: |\n| 1 | 2 |\n尾段");
    expect(table.map((block) => block.markdown)).toEqual([
      "| a | b |\n| :--- | ---: |\n| 1 | 2 |",
      "尾段",
    ]);
  });

  it("任务列表/括号有序列表/缩进代码让超 80 行的块保持原子", () => {
    const prose = Array.from({ length: 85 }, (_, index) => `line ${index + 1}`);
    expect(segmentMarkdownDocumentBlocks(prose.join("\n"))).toHaveLength(2);

    const withTask = [...prose, "- [ ] 待办"];
    const atomic = segmentMarkdownDocumentBlocks(withTask.join("\n"));
    expect(atomic).toHaveLength(1);
    expect(atomic[0]?.markdown.split("\n")).toHaveLength(86);

    expect(segmentMarkdownDocumentBlocks([...prose, "10) 括号有序"].join("\n"))).toHaveLength(1);
    expect(segmentMarkdownDocumentBlocks([...prose, "    indented"].join("\n"))).toHaveLength(1);
  });

  it("块 key 由 1 基行号区间与内容 hash 构成,行号位移即变", () => {
    const first = segmentMarkdownDocumentBlocks("# t\n\nbody");
    expect(first[0]).toMatchObject({ startLine: 1, endLine: 1 });
    expect(first[0]?.key.startsWith("1:1:")).toBe(true);

    const shifted = segmentMarkdownDocumentBlocks("\n\n# t\n\nbody");
    expect(shifted[0]?.key.startsWith("3:3:")).toBe(true);
    expect(shifted[0]?.key).not.toBe(first[0]?.key);
    expect(segmentMarkdownDocumentBlocks("# t\n\nbody")[0]?.key).toBe(first[0]?.key);
  });

  it("CRLF 行尾与 LF 等价切分", () => {
    const blocks = segmentMarkdownDocumentBlocks("# 标\r\n\r\n```ts\r\nx\r\n```");
    expect(blocks.map((block) => block.markdown)).toEqual(["# 标", "```ts\nx\n```"]);
  });
});

describe("countMarkdownBlocks", () => {
  it("空串零计数,连续段落按空行聚合", () => {
    expect(countMarkdownBlocks("")).toEqual({ blockCount: 0, heavyBlockCount: 0 });
    expect(countMarkdownBlocks("第一行\n第二行\n\n第三行")).toEqual({
      blockCount: 2,
      heavyBlockCount: 0,
    });
  });

  it("栅栏按语言计重块,体内行不计数,语言大小写不敏感", () => {
    const doc = "```mermaid\ngraph TD\n```\n\n```TEX\nx\n```\n\n```\nplain\n```";
    expect(countMarkdownBlocks(doc)).toEqual({ blockCount: 3, heavyBlockCount: 2 });
  });

  it("结构行(标题/引用/列表)各计一块,表格行计入重块", () => {
    const doc = "# 标题\n> 引用\n- 列表\n| a | b |\n| --- | --- |";
    expect(countMarkdownBlocks(doc)).toEqual({ blockCount: 5, heavyBlockCount: 2 });
  });

  it("CRLF 输入正常计数,普通栅栏计一块非重块", () => {
    expect(countMarkdownBlocks("# a\r\n\r\nb")).toEqual({ blockCount: 2, heavyBlockCount: 0 });
    expect(countMarkdownBlocks("```ts\nx\n```")).toEqual({ blockCount: 1, heavyBlockCount: 0 });
  });
});

describe("markdownMath", () => {
  it("detectMathContent:空值与普通文本为假,四族定界符为真", () => {
    expect(detectMathContent(null)).toBe(false);
    expect(detectMathContent(undefined)).toBe(false);
    expect(detectMathContent("")).toBe(false);
    expect(detectMathContent("普通段落没有公式")).toBe(false);
    expect(detectMathContent("$$\n\\sum_i i\n$$")).toBe(true);
    expect(detectMathContent("行内 $a+b$ 公式")).toBe(true);
    expect(detectMathContent("\\(a+b\\) 与 \\[\\sum_i i\\]")).toBe(true);
    expect(detectMathContent("```latex\nx\n```")).toBe(true);
    expect(detectMathContent("```Math\nx\n```")).toBe(true);
  });

  it("detectMathContent:转义 \\$ 的金额文本不误判,普通代码栅栏不误判", () => {
    expect(detectMathContent("\\$5 与 \\$10")).toBe(false);
    expect(detectMathContent("```ts\nconst a = 1;\n```")).toBe(false);
  });

  it("懒加载契约:未加载时 ready 为假,渲染降级返回 null", () => {
    expect(areKatexAssetsReady()).toBe(false);
    expect(getCachedRehypeKatex()).toBeNull();
    expect(renderLatexFormula("$$a+b$$")).toBeNull();
  });

  it("加载后渲染公式:四族定界解包等价裸公式,解析错误降级 null", async () => {
    await loadKatexAssets();
    expect(areKatexAssetsReady()).toBe(true);

    const bare = renderLatexFormula("a+b");
    expect(bare).not.toBeNull();
    expect(bare).not.toContain("katex-error");
    expect(renderLatexFormula("$$a+b$$")).toBe(bare);
    expect(renderLatexFormula("\\[a+b\\]")).toBe(bare);
    expect(renderLatexFormula("\\(a+b\\)")).toBe(bare);
    expect(renderLatexFormula("$a+b$")).toBe(bare);
    // 结构性解析错误(参数缺失)→ katex-error → null;未知命令走 throwOnError:false 红字渲染,非 null
    expect(renderLatexFormula("\\frac{1}")).toBeNull();
    expect(renderLatexFormula("\\bork{1}")).not.toBeNull();
    expect(renderLatexFormula("\\bork{1}")).toContain("katex");
  });
});

describe("extractLanguageTag", () => {
  it("language- 前缀判别:缺省/无匹配/空前缀返回 null,命中取首个词", () => {
    expect(extractLanguageTag()).toBeNull();
    expect(extractLanguageTag("")).toBeNull();
    expect(extractLanguageTag("highlight js")).toBeNull();
    expect(extractLanguageTag("language-")).toBeNull();
    expect(extractLanguageTag("language-ts")).toBe("ts");
    expect(extractLanguageTag("highlight language-python")).toBe("python");
    expect(extractLanguageTag("language-cpp17 language-other")).toBe("cpp17");
  });

  it("前缀匹配大小写不敏感,命中词保留原样大小写", () => {
    expect(extractLanguageTag("Language-TS")).toBe("TS");
    expect(extractLanguageTag("language-Rust")).toBe("Rust");
  });
});
