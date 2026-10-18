/**
 * ghost 后缀展示截断单测(042 双轨语义钉死):
 * 存储与 accept 一律全文;只有展示窗口截断到 MAX_TEXT_LENGTH(300)+「…」。
 */
import { describe, expect, it } from "vitest";
import { MAX_TEXT_LENGTH } from "@kernel/promptHistory";
import { ghostSuffix } from "./usePromptHistory";

describe("ghostSuffix", () => {
  it("短后缀原样返回(无「…」)", () => {
    expect(ghostSuffix("fix the login bug", "fix the")).toBe(" login bug");
    expect(ghostSuffix("abc", "")).toBe("abc");
  });

  it("等长/更短建议返回空串(无可补后缀)", () => {
    expect(ghostSuffix("run tests", "run tests")).toBe("");
    expect(ghostSuffix("ab", "abc")).toBe("");
  });

  it("超长后缀截断到 300 字符并追加「…」(展示窗口)", () => {
    const suggestion = "q" + "x".repeat(500);
    const suffix = ghostSuffix(suggestion, "q");
    expect(suffix).toHaveLength(MAX_TEXT_LENGTH + 1);
    expect(suffix.endsWith("…")).toBe(true);
    expect(suffix.startsWith("x".repeat(300))).toBe(true);
  });

  it("恰好 300 字符的后缀不追加「…」(边界:窗口内不标)", () => {
    const suggestion = "q" + "x".repeat(300);
    expect(ghostSuffix(suggestion, "q")).toBe("x".repeat(300));
  });
});
