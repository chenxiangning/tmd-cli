/**
 * evidence 纯函数测试(W2 存证链):老侧 hunk 解析 / 区间相交边界 /
 * A·D 排除口径 / reverted 降级 / open 轮三值(徽章 = 轮次 some(eff),面板一行)。
 */
import { describe, expect, it } from "vitest";
import { intersects, parseOldRanges, verdictFor, type RoundInput } from "./evidence";
const MARK = { startLine: 10, endLine: 20 };
const HIT = "@@ -12,4 +12,4 @@\n ctx";
const MISS = "@@ -1,3 +1,3 @@\n ctx";

const round = (over: Partial<RoundInput>): RoundInput => ({
  open: false,
  reverted: false,
  carried: true,
  patch: HIT,
  ...over,
});

describe("parseOldRanges 老侧区间解析", () => {
  it("常规 hunk:起点+长度展开为闭区间", () => {
    expect(parseOldRanges("@@ -8,7 +8,9 @@\n ctx")).toEqual([[8, 14]]);
  });

  it("省略长度 = 单行;len=0 纯插入锚点不产区间", () => {
    expect(parseOldRanges("@@ -5 +5,2 @@\n x")).toEqual([[5, 5]]);
    expect(parseOldRanges("@@ -9,0 +9,3 @@\n+a")).toEqual([]);
  });

  it("多 hunk 逐个解析,空 patch 无区间", () => {
    expect(parseOldRanges("@@ -1,3 +1,2 @@\n a\n@@ -100,4 +99,4 @@\n d")).toEqual([
      [1, 3],
      [100, 103],
    ]);
    expect(parseOldRanges("")).toEqual([]);
  });
});

describe("intersects 闭区间相交", () => {
  const r = (a: number, b: number) => intersects([10, 20], [a, b]);
  it("内含/越界重叠/首尾相切都命中", () => {
    expect(r(12, 15)).toBe(true);
    expect(r(18, 30)).toBe(true);
    expect(r(10, 10)).toBe(true);
    expect(r(20, 25)).toBe(true);
  });
  it("区间外(含批上方纯插入的 len=0 已滤)不命中", () => {
    expect(r(1, 9)).toBe(false);
    expect(r(21, 40)).toBe(false);
  });
});

describe("verdictFor 轮次三值", () => {
  it("未携带该标记 = null(不进参与轮次)", () => {
    expect(verdictFor(MARK, round({ carried: false }))).toBeNull();
  });

  it("open 批 = 进行中(封口后判定),不看 patch", () => {
    expect(verdictFor(MARK, round({ open: true, patch: null }))).toBe("open");
  });

  it("相交未回退 = eff;相交已回退 = revt(回退联动降级)", () => {
    expect(verdictFor(MARK, round({}))).toBe("eff");
    expect(verdictFor(MARK, round({ reverted: true }))).toBe("revt");
  });

  it("hunk 在标记区间外 / patch 缺失(A·D·二进制·未取到)= none", () => {
    expect(verdictFor(MARK, round({ patch: MISS }))).toBe("none");
    expect(verdictFor(MARK, round({ patch: null }))).toBe("none");
  });
});
