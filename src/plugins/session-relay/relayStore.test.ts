/**
 * relayStore pending 接力载荷契约测试 —— 置/弃/读/订阅与 LRU 上限。
 * 载荷 keyed by 目标会话 id;发送消费/失败恢复(relayCarry)不在本测范围。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropPendingRelay,
  getPendingRelay,
  setPendingRelay,
  subscribePendingRelay,
} from "./relayStore";
import type { RelaySource } from "./relay";

const src: RelaySource = { profileId: "omp", engineName: "omp" };

afterEach(() => {
  for (const id of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]) {
    dropPendingRelay(id);
  }
});

describe("pendingRelay 载荷", () => {
  it("置/读/弃:默认无,置后同引用可读,弃后清空并通知", () => {
    expect(getPendingRelay("s1")).toBeNull();
    const payload = { text: "摘要", truncated: false, source: src };
    setPendingRelay("s1", payload);
    expect(getPendingRelay("s1")).toBe(payload);
    dropPendingRelay("s1");
    expect(getPendingRelay("s1")).toBeNull();
  });

  it("同会话覆盖 = 新载荷替换;订阅在置/弃时都收到通知", () => {
    const listener = vi.fn();
    const off = subscribePendingRelay(listener);
    setPendingRelay("s2", { text: "a", truncated: false, source: src });
    setPendingRelay("s2", { text: "b", truncated: true, source: src });
    expect(getPendingRelay("s2")?.text).toBe("b");
    dropPendingRelay("s2");
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    setPendingRelay("s2", { text: "c", truncated: false, source: src });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("LRU 上限 8:第 9 个会话置入淘汰最老条目", () => {
    for (let i = 1; i <= 9; i += 1) {
      setPendingRelay(`s${i}`, { text: `t${i}`, truncated: false, source: src });
    }
    expect(getPendingRelay("s1")).toBeNull();
    expect(getPendingRelay("s2")?.text).toBe("t2");
    expect(getPendingRelay("s9")?.text).toBe("t9");
  });
});
