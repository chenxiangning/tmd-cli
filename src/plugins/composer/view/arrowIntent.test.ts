/**
 * resolveArrowIntent 单测 —— 判定顺序即契约:IME → 下拉 → 非空 → 移交。
 */
import { describe, expect, it } from "vitest";
import { resolveArrowIntent } from "./arrowIntent";

const base = { key: "ArrowUp", value: "", hasMatches: false, isComposing: false };

describe("resolveArrowIntent", () => {
  it("空输入 + 无下拉 + 非 IME:↑↓ 移交幕布", () => {
    expect(resolveArrowIntent(base)).toBe("handoff");
    expect(resolveArrowIntent({ ...base, key: "ArrowDown" })).toBe("handoff");
  });

  it("非方向键一律 default", () => {
    expect(resolveArrowIntent({ ...base, key: "ArrowLeft" })).toBe("default");
    expect(resolveArrowIntent({ ...base, key: "Enter" })).toBe("default");
  });

  it("IME 组合中不移交(交给输入法)", () => {
    expect(resolveArrowIntent({ ...base, isComposing: true })).toBe("default");
  });

  it("候选下拉打开时不移交(下拉自己的 ↑↓)", () => {
    expect(resolveArrowIntent({ ...base, hasMatches: true })).toBe("default");
  });

  it("非空输入不移交(光标移动)", () => {
    expect(resolveArrowIntent({ ...base, value: " /mod" })).toBe("default");
    expect(resolveArrowIntent({ ...base, value: "   " })).toBe("handoff"); // 纯空白视同空
  });
});
