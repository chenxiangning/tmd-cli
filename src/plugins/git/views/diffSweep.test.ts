import { describe, expect, it } from "vitest";
import { sweepKeys } from "./diffSweep";

const order = ["a", "b", "c", "d"];

describe("sweepKeys", () => {
  it("正向拖选:含两端闭区间", () => {
    expect(sweepKeys(order, 1, 2)).toEqual(["b", "c"]);
  });

  it("反向拖选(从下往上扫)与正向同集", () => {
    expect(sweepKeys(order, 3, 0)).toEqual(["a", "b", "c", "d"]);
  });

  it("单点(锚点即终点)只取一行", () => {
    expect(sweepKeys(order, 2, 2)).toEqual(["c"]);
  });

  it("越界自动截断,不抛错", () => {
    expect(sweepKeys(order, -2, 1)).toEqual(["a", "b"]);
    expect(sweepKeys(order, 2, 99)).toEqual(["c", "d"]);
  });

  it("空行集返回空数组", () => {
    expect(sweepKeys([], 0, 3)).toEqual([]);
  });
});
