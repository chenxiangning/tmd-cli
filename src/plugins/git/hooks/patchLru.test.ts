/**
 * PatchLRU 契约:容量 50;get 命中提升热度;超出淘汰最久未用;put 同 key 覆盖不增容。
 */

import { describe, expect, it } from "vitest";
import type { GitFilePatch } from "@kernel/ipc";
import { PatchLRU } from "./patchLru";

function patch(path: string): GitFilePatch {
  return {
    path,
    oldPath: null,
    kind: "M",
    additions: 1,
    deletions: 0,
    patch: "+x",
    binary: false,
  };
}

describe("PatchLRU", () => {
  it("get 命中返回并提升热度", () => {
    const lru = new PatchLRU();
    lru.put("a", patch("a"));
    lru.put("b", patch("b"));
    expect(lru.get("a")?.path).toBe("a");
    // 热度序 [b, a];再填 49 个 → 超容 1 个,淘汰最旧的 b,a 保留
    for (let i = 0; i < 49; i++) lru.put(`k${i}`, patch(`k${i}`));
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")?.path).toBe("a");
  });

  it("容量恒 ≤50", () => {
    const lru = new PatchLRU();
    for (let i = 0; i < 80; i++) lru.put(`k${i}`, patch(`k${i}`));
    // 最旧的 30 个(k0..k29)已被淘汰
    expect(lru.get("k0")).toBeUndefined();
    expect(lru.get("k29")).toBeUndefined();
    expect(lru.get("k30")?.path).toBe("k30");
    expect(lru.get("k79")?.path).toBe("k79");
  });

  it("put 同 key 覆盖不占新容量", () => {
    const lru = new PatchLRU();
    lru.put("a", patch("a"));
    lru.put("a", patch("a2"));
    expect(lru.get("a")?.path).toBe("a2");
  });

  it("clear 清空", () => {
    const lru = new PatchLRU();
    lru.put("a", patch("a"));
    lru.clear();
    expect(lru.get("a")).toBeUndefined();
  });
});
