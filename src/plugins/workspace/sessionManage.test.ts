/**
 * 管理模式拖选范围扩散契约(selectRange):
 * - 加选扩散只影响 [from..to],范围外保持不变
 * - 取消扩散同形(val=false),不误伤范围外已选
 * - from > to(向上拖)与越界下标(行集收缩后的陈旧锚点)均确定性行事
 */
import { describe, expect, it } from "vitest";
import { selectRange } from "./SessionManage";

const ORDER = ["a", "b", "c", "d", "e"];

describe("selectRange", () => {
  it("加选扩散:范围内全选,范围外保持", () => {
    const prev = new Set(["a"]);
    expect(selectRange(prev, ORDER, 1, 3, true)).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
  });

  it("取消扩散:只清范围内,范围外已选保留", () => {
    const prev = new Set(["a", "b", "c", "d", "e"]);
    expect(selectRange(prev, ORDER, 1, 3, false)).toEqual(
      new Set(["a", "e"]),
    );
  });

  it("向上拖(from > to)按无序区间扩散", () => {
    expect(selectRange(new Set(), ORDER, 3, 1, true)).toEqual(
      new Set(["b", "c", "d"]),
    );
  });

  it("越界下标跳过(陈旧锚点防崩)", () => {
    expect(selectRange(new Set(), ORDER, 3, 99, true)).toEqual(
      new Set(["d", "e"]),
    );
  });
});
