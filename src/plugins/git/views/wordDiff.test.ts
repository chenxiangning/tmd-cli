/**
 * wordDiff 纯逻辑契约:左右两栏 parts 只含本侧文本。
 * 回归锚 = 2026-09-15 线上事故:旧实现在 LCS 回溯里把对侧 token 当
 * 「未标注」推进本侧,右栏渲染出左栏删除文本(拼接串屏)。
 */
import { describe, expect, it } from "vitest";
import { wordDiff } from "./wordDiff";

const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

describe("wordDiff", () => {
  it("修改对:两栏各只含本侧文本", () => {
    const [del, ins] = wordDiff("<dependency> old tail", "<dependency> new tail extra");
    expect(text(del)).toBe("<dependency> old tail");
    expect(text(ins)).toBe("<dependency> new tail extra");
    // 左栏绝不出现右栏独有 token,反之亦然
    expect(text(del)).not.toContain("new");
    expect(text(del)).not.toContain("extra");
    expect(text(ins)).not.toContain("old");
  });

  it("纯插入:左栏原样、右栏带 ins 标注", () => {
    const [del, ins] = wordDiff("a b", "a x b");
    expect(text(del)).toBe("a b");
    expect(del.every((p) => !p.tag)).toBe(true); // 左栏无删标注
    expect(text(ins)).toBe("a x b");
    expect(ins.some((p) => p.tag === "ins" && p.text.includes("x"))).toBe(true);
  });

  it("纯删除:右栏原样、左栏带 del 标注", () => {
    const [del, ins] = wordDiff("a x b", "a b");
    expect(text(ins)).toBe("a b");
    expect(ins.every((p) => !p.tag)).toBe(true);
    expect(text(del)).toBe("a x b");
    expect(del.some((p) => p.tag === "del" && p.text.includes("x"))).toBe(true);
  });

  it("超限退化:整行标注且不串侧", () => {
    const a = Array.from({ length: 200 }, (_, i) => `t${i}`).join(" ");
    const b = Array.from({ length: 200 }, (_, i) => `u${i}`).join(" ");
    const [del, ins] = wordDiff(a, b);
    expect(text(del)).toBe(a);
    expect(text(ins)).toBe(b);
    expect(del.every((p) => p.tag === "del")).toBe(true);
    expect(ins.every((p) => p.tag === "ins")).toBe(true);
  });

  it("星面字符按码点整配:公共 emoji 不劈半、两侧文本无 U+FFFD", () => {
    const [del, ins] = wordDiff("ok 😀 ship", "ok 🚀 ship");
    expect(text(del)).toBe("ok 😀 ship");
    expect(text(ins)).toBe("ok 🚀 ship");
    expect(text(del)).not.toContain("\uFFFD");
    expect(text(ins)).not.toContain("\uFFFD");
    /* 改动段标注在位:😀 整字符作 del、🚀 整字符作 ins(劈半则出现两个半代理项段) */
    expect(del.some((p) => p.tag === "del" && p.text.includes("😀"))).toBe(true);
    expect(ins.some((p) => p.tag === "ins" && p.text.includes("🚀"))).toBe(true);
  });
});
