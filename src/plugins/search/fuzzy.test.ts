import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("非子序列返回 null", () => {
    expect(fuzzyMatch("zfx", "src/fuzzy.ts")).toBeNull();
    expect(fuzzyMatch("fz", "abc")).toBeNull();
  });

  it("大小写不敏感", () => {
    expect(fuzzyMatch("FZ", "fuzzy.ts")).not.toBeNull();
    expect(fuzzyMatch("fz", "FUZZY.TS")).not.toBeNull();
  });

  it("空查询零分通过(全量列表语义)", () => {
    expect(fuzzyMatch("", "any")).toEqual({ score: 0, indices: [] });
  });

  it("indices 为贪心命中下标", () => {
    // f@0, z@2(u 跳过)
    expect(fuzzyMatch("fz", "fuzzy")!.indices).toEqual([0, 2]);
  });

  it("词首与连续加分,排序可用", () => {
    // 同是子序列:词首 + 连续的排前
    const good = fuzzyMatch("ft", "fuzzy.test.ts")!.score; // f 词首,t 词首(. 后)
    const bad = fuzzyMatch("ft", "format!")!.score; // f 词首,t 词中
    expect(good).toBeGreaterThan(bad);
    const consecutive = fuzzyMatch("fu", "fuzzy")!.score; // 连续
    const scattered = fuzzyMatch("fz", "fuzzy")!.score; // 跳字
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("位置罚分:同形态命中靠前的路径得分更高", () => {
    const near = fuzzyMatch("f", "f/a.txt")!.score;
    const far = fuzzyMatch("f", "xxxxxxxxxx/f/a.txt")!.score;
    expect(near).toBeGreaterThan(far);
  });
});
