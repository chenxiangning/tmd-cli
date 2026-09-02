/**
 * 显示预算提交校验纯函数测试(budgetCommit):
 * total 越界/小于已分配拒绝、配额非法拒绝、空串删 key 回均分、
 * 显式 0 合法、写入基底剪除已卸载 CLI 残留 key(残留不得抬高已分配)。
 */
import { describe, expect, it } from "vitest";
import { commitQuota, commitTotal, prunePerCli } from "./budgetCommit";

const IDS = ["omp", "pi", "kimi", "codex"];

describe("prunePerCli", () => {
  it("剪除已卸载 CLI 的残留 key", () => {
    expect(prunePerCli({ omp: 3, ghost: 9 }, IDS)).toEqual({ omp: 3 });
  });
});

describe("commitTotal", () => {
  it("越界/非整数输入拒绝并给行内提示", () => {
    for (const raw of ["", "abc", "0", "101", "-5"]) {
      const result = commitTotal({ total: 20, perCli: {} }, IDS, raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.hint).toContain("总数");
    }
  });

  it("小于已分配配额之和拒绝,恰好等于则合法", () => {
    const budget = { total: 20, perCli: { omp: 8, pi: 8 } };
    expect(commitTotal(budget, IDS, "15").ok).toBe(false);
    expect(commitTotal(budget, IDS, "16")).toEqual({
      ok: true,
      value: { total: 16, perCli: { omp: 8, pi: 8 } },
    });
  });

  it("合法写入:新总数 + 剪残留后的 perCli", () => {
    const budget = { total: 20, perCli: { omp: 3, ghost: 9 } };
    expect(commitTotal(budget, IDS, "30")).toEqual({
      ok: true,
      value: { total: 30, perCli: { omp: 3 } },
    });
  });
});

describe("commitQuota", () => {
  const budget = { total: 20, perCli: { omp: 5, pi: 5 } };

  it("空串/空白 = 删除预留回到均分", () => {
    expect(commitQuota(budget, "omp", IDS, "")).toEqual({
      ok: true,
      value: { total: 20, perCli: { pi: 5 } },
    });
    expect(commitQuota(budget, "omp", IDS, "  ").ok).toBe(true);
  });

  it("负数/非整数/超出剩余空间拒绝,上限值合法", () => {
    expect(commitQuota(budget, "kimi", IDS, "-1").ok).toBe(false);
    expect(commitQuota(budget, "kimi", IDS, "abc").ok).toBe(false);
    // others = 5+5 = 10,total = 20 → kimi 上限 10
    expect(commitQuota(budget, "kimi", IDS, "11").ok).toBe(false);
    expect(commitQuota(budget, "kimi", IDS, "10")).toEqual({
      ok: true,
      value: { total: 20, perCli: { omp: 5, pi: 5, kimi: 10 } },
    });
  });

  it("显式 0 合法 = 该 CLI 初始不露出历史", () => {
    expect(commitQuota(budget, "kimi", IDS, "0")).toEqual({
      ok: true,
      value: { total: 20, perCli: { omp: 5, pi: 5, kimi: 0 } },
    });
  });

  it("写入基底剪残留:残留 key 不抬高已分配,自身配额可覆盖", () => {
    const dirty = { total: 20, perCli: { omp: 5, ghost: 14 } };
    // 残留剪除后 others = 0,7 合法;未剪会误判 5+14+7 > 20 而拒绝
    expect(commitQuota(dirty, "omp", IDS, "7")).toEqual({
      ok: true,
      value: { total: 20, perCli: { omp: 7 } },
    });
  });
});
