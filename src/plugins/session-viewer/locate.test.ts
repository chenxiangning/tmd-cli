/** 转录定位匹配单测:needle 梯队退化 / occurrence 同文定位 / user 域过滤 / @token 剥除。 */
import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import { findBlockIndex } from "./locate";

const blk = (id: string, role: CliTranscriptBlock["role"], text: string): CliTranscriptBlock =>
  ({ id, role, text, startedAt: 0 }) as CliTranscriptBlock;

const blocks = [
  blk("a", "user", "帮我实现深色主题切换"),
  blk("b", "assistant", "好的,开始实现"),
  blk("c", "reasoning", "思考中…"),
  blk("d", "user", "把登录做成深色配色"),
  blk("e", "user", "再改一次,把登录做成深色配色更柔和"),
];

describe("findBlockIndex", () => {
  it("全文命中 user 块;assistant/reasoning 不计入", () => {
    expect(findBlockIndex(blocks, "把登录做成深色配色")).toBe(3);
    expect(findBlockIndex(blocks, "深色主题切换")).toBe(0);
    expect(findBlockIndex(blocks, "好的,开始实现")).toBeNull();
    expect(findBlockIndex(blocks, "思考中")).toBeNull();
  });

  it("occurrence 同文定位第 k 条;超出命中数 = null", () => {
    expect(findBlockIndex(blocks, "把登录做成深色配色", 2)).toBe(4);
    expect(findBlockIndex(blocks, "把登录做成深色配色", 3)).toBeNull();
  });

  it("needle 梯队退化:目标文本比块内原文长(截断语义)也能短 needle 命中", () => {
    expect(findBlockIndex(blocks, "把登录做成深色配色然后顺便看看别的", 1)).toBe(3);
  });

  it("@token 剥除后匹配(附件引用不参与 needle)", () => {
    expect(findBlockIndex(blocks, "@src/a.ts 把登录做成深色配色", 1)).toBe(3);
  });

  it("不匹配任何块 → null;空文本块跳过", () => {
    expect(findBlockIndex(blocks, "完全不相关的内容词")).toBeNull();
    expect(findBlockIndex([blk("x", "user", "")], "深色")).toBeNull();
  });
});
