import { describe, expect, it, vi } from "vitest";
import {
  consumePendingPrompt,
  dropPendingPrompt,
  getPendingPrompt,
  setPendingPrompt,
  subscribePendingPrompts,
} from "./sessionPending";

describe("sessionPending", () => {
  it("set 后 get 命中;consume 原子读+清,二次 consume 为 null", () => {
    setPendingPrompt("s1", "初始提示词全文");
    expect(getPendingPrompt("s1")).toBe("初始提示词全文");
    expect(consumePendingPrompt("s1")).toBe("初始提示词全文");
    expect(getPendingPrompt("s1")).toBeNull();
    expect(consumePendingPrompt("s1")).toBeNull();
  });

  it("同一会话重复 set 覆盖并刷新 LRU 位次", () => {
    for (let i = 0; i < 8; i++) setPendingPrompt(`k${i}`, `t${i}`);
    setPendingPrompt("k0", "refresh"); /* k0 重插到最末,不再是最老 */
    setPendingPrompt("k8", "t8");
    expect(getPendingPrompt("k1")).toBeNull(); /* 最老被挤出的轮到 k1 */
    expect(getPendingPrompt("k0")).toBe("refresh");
  });

  it("超过 8 条按插入序淘汰最老", () => {
    for (let i = 0; i < 9; i++) setPendingPrompt(`n${i}`, `t${i}`);
    expect(getPendingPrompt("n0")).toBeNull();
    expect(getPendingPrompt("n1")).toBe("t1");
    expect(getPendingPrompt("n8")).toBe("t8");
  });

  it("drop 未命中 no-op 不触发订阅;命中触发;set/consume 触发", () => {
    const fn = vi.fn();
    const off = subscribePendingPrompts(fn);
    dropPendingPrompt("nope");
    expect(fn).not.toHaveBeenCalled();
    setPendingPrompt("s1", "x");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(consumePendingPrompt("s1")).toBe("x");
    expect(fn).toHaveBeenCalledTimes(2);
    dropPendingPrompt("s1"); /* 已被 consume 清空,no-op */
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });
});
