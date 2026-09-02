/**
 * 锚点栏分桶抽样测试 —— codemoss MessagesAnchorRail 移植算法的契约:
 * 容量内全显;超容量均分桶取中点;active 所在桶强制显示 active。
 */

import { describe, expect, it } from "vitest";
import { sampleAnchors } from "./AnchorRail";
import type { UserMessageAnchor } from "@kernel/messageAnchors";

const anchors = (n: number): UserMessageAnchor[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, text: `消息 ${i}` }));

describe("sampleAnchors", () => {
  it("锚点数 ≤ 容量:全量显示,序号即原序", () => {
    const list = anchors(10);
    const visible = sampleAnchors(list, 32, null);
    expect(visible).toHaveLength(10);
    expect(visible.map((v) => v.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("超容量:收敛到容量数,首尾锚点必在", () => {
    const list = anchors(100);
    const visible = sampleAnchors(list, 12, null);
    expect(visible).toHaveLength(12);
    expect(visible[0]!.anchor.id).toBe("m3"); /* 桶 0:start=0,end=8,中点 floor(7/2)=3 */
    expect(visible.at(-1)!.anchor.id).toBe("m95");
  });

  it("active 所在桶强制取 active", () => {
    const list = anchors(100);
    const visible = sampleAnchors(list, 12, "m50");
    const bucket = visible.find((v) => v.anchor.id === "m50");
    expect(bucket).toBeDefined();
    expect(bucket!.index).toBe(50);
  });

  it("active 为 null 时退化为桶中点", () => {
    const list = anchors(100);
    const withActive = sampleAnchors(list, 12, "m50").map((v) => v.anchor.id);
    const without = sampleAnchors(list, 12, null).map((v) => v.anchor.id);
    /* 只有 active 所在桶不同,其余桶一致 */
    expect(without.filter((id) => withActive.includes(id)).length).toBe(11);
  });
});
