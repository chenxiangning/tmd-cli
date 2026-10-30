/**
 * rulesExtract 单测 —— 行分类/围栏/表格块/信号词三通道/路径引用门槛/命令抽取
 * (移植 tmd-lint rules.rs 的口径锚点,阈值一个不松)。
 */
import { describe, expect, it } from "vitest";

import { extractCommand, extractRules, pathRefsOf, signalTokens } from "./rulesExtract";

describe("signalTokens", () => {
  it("三通道:「」引用短语 / 反引号串(不含空格)/ ascii 连续串,停用词剔除", () => {
    const toks = signalTokens("提交信息用「半角符号」格式,跑 `pnpm check:gate`,详见 docs/review/flow.md,not for you");
    expect(toks).toContain("半角符号");
    expect(toks).toContain("check:gate"); /* 反引号串含空格不入表;ascii 通道给 check:gate */
    expect(toks).not.toContain("pnpm check:gate");
    expect(toks).toContain("docs/review/flow.md");
    expect(toks).not.toContain("not");
    expect(toks).not.toContain("for");
  });

  it("超高频常用词与过短串不入词表", () => {
    const toks = signalTokens("Use the and of to a an in on with your all can see one two");
    expect(toks).toEqual([]);
  });
});

describe("pathRefsOf", () => {
  it("形态门槛:含 /、非绝对、非 URL、非扩展名枚举", () => {
    const refs = pathRefsOf([
      "docs/review/flow.md", "/abs/path", "https://x.com/a", ".ts/.tsx/.rs", "src/plugins", "ab",
    ]);
    expect(refs).toEqual(["docs/review/flow.md", "src/plugins"]);
  });
});

describe("extractCommand", () => {
  it("抽第一条 pnpm/npx/npm run/cargo 命令;非命令文本回空", () => {
    expect(extractCommand("交付前必须跑 pnpm check:gate 一条命令")).toBe("pnpm check:gate");
    /* 命令串字符集含空格:吞到首个非法字符(CJK「再」)为止,移植口径如此 */
    expect(extractCommand("先 npx tsc --noEmit 再提交")).toBe("npx tsc --noEmit");
    expect(extractCommand("写文档要结论先行")).toBe("");
  });
});

describe("extractRules", () => {
  const md = [
    "# 验证",
    "",
    "- 交付前必须跑 `pnpm check:gate`,不得只跑一段。",
    "```",
    "- 围栏内的不算规则",
    "```",
    "| 产出 | 去处 |",
    "|---|---|",
    "| 设计 spec | docs/ |",
    "",
    "## 提交",
    "* 提交信息用「中文一句话祈使句」,见 git log。",
  ].join("\n");

  it("行分类:bullet 进、围栏不出、段落不进;章节跟随最近标题", () => {
    const rules = extractRules(md, "/ws/AGENTS.md");
    expect(rules.map((r) => [r.line, r.section])).toEqual([
      [3, "验证"],
      [7, "验证"], /* 表格整块记表头行号 */
      [12, "提交"],
    ]);
  });

  it("表格整块合一条(line=表头,lineEnd 扩到块末,原文含分隔行)", () => {
    const rules = extractRules(md, "/ws/AGENTS.md");
    const table = rules.find((r) => r.text.includes("|---|"))!;
    expect(table.line).toBe(7);
    expect(table.lineEnd).toBe(9);
    expect(table.text.split("\n")).toHaveLength(3);
  });

  it("idx 从 1 连续递增(批判定对位 key)", () => {
    const rules = extractRules(md, "/ws/AGENTS.md");
    expect(rules.map((r) => r.idx)).toEqual([1, 2, 3]);
  });
});
