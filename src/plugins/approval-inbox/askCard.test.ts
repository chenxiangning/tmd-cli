import { describe, expect, it } from "vitest";
import { parseAskCard } from "./askCard";

/** omp select 卡真实结构(2026-09-27 幕布截图样本,剥 ANSI 后):
 *  卡标题(∞ 前缀)/ Ask / tab 行(问题N · … · Submit)/ 问题正文 / 选项块 / 页脚。 */
const TWO_Q = [
  "∞ 再提两个问题",
  "Ask",
  "开发节奏  会话体验  Submit",
  "接下来想推进哪块工作?",
  "❯ ● PR #40 收尾",
  "    v0.2.5 六件已全部落地,跟进 PR #40 评审/合并",
  "  ○ 推进 0.2.6 russh",
  "      russh 0.63 MSRV 1.85 超仓内 1.80,0.2.6 配真连验证",
  "  ○ 回头清理磁盘",
  "  ○ Other (type your own)",
  "← select · n note · ↑/↓ move · ⌘ cancel",
].join("\n");

describe("parseAskCard(omp select 卡结构化)", () => {
  it("双问卡:当前问题正文 + 选项序即数字键 + 问题总数", () => {
    const card = parseAskCard(TWO_Q);
    expect(card?.question).toBe("接下来想推进哪块工作?");
    expect(card?.options).toEqual(["PR #40 收尾", "推进 0.2.6 russh", "回头清理磁盘", "Other (type your own)"]);
    expect(card?.multi).toBe(2);
  });

  it("选项下的缩进描述行不混入选项文本", () => {
    const card = parseAskCard(TWO_Q);
    expect(card?.options.some((o) => o.includes("MSRV"))).toBe(false);
    expect(card?.options.some((o) => o.includes("六件已全部落地"))).toBe(false);
  });

  it("单问卡(tab 行仅一词 + Submit)→ multi=1", () => {
    const card = parseAskCard(
      ["Ask", "开发节奏  Submit", "接下来想推进哪块工作?", "● PR #40 收尾", "○ Other (type your own)"].join("\n"),
    );
    expect(card?.multi).toBe(1);
    expect(card?.options).toEqual(["PR #40 收尾", "Other (type your own)"]);
  });

  it("Review answers 总结态:问题正文即该行,Submit 成为唯一选项", () => {
    const card = parseAskCard(
      [
        "Ask",
        "开发节奏  会话体验  Submit",
        "Review answers",
        "1. 开发节奏: 回头清理磁盘",
        "2. 会话体验: 维持现状",
        "❯ Submit",
      ].join("\n"),
    );
    expect(card?.question).toBe("Review answers");
    expect(card?.options).toEqual(["Submit"]);
  });

  it("非卡文本(无选项块)→ null", () => {
    expect(parseAskCard("building…\nmc: 19.4K (2%)\n idle")).toBeNull();
    expect(parseAskCard("Do you want to proceed? [y/n] ")).toBeNull();
  });
});
