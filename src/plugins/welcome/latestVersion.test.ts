/**
 * latestVersion 单元测试 —— 守住两个可观察契约:
 * 1. extractSemver:从各 CLI 真实 --version 输出格式里抠三元组;
 * 2. isOutdated:数值比较(非字符串比较,"9.x" < "10.x"),不可解析不误报。
 */

import { describe, expect, it } from "vitest";
import { extractSemver, isOutdated } from "./latestVersion";

describe("extractSemver", () => {
  it.each([
    ["omp/18.0.11", "18.0.11"],
    ["0.84.4", "0.84.4"],
    ["codex-cli 0.152.0", "0.152.0"],
    ["2.1.251 (Claude Code)", "2.1.251"],
  ])("从真实版本串 %s 抠出 %s", (raw, expected) => {
    expect(extractSemver(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["已安装"], ["v1.2 无补丁位"]])(
    "无法解析 %s → null",
    (raw) => {
      expect(extractSemver(raw)).toBeNull();
    },
  );
});

describe("isOutdated", () => {
  it("补丁位落后 → true", () => {
    expect(isOutdated("omp/18.0.11", "18.0.12")).toBe(true);
  });

  it("数值比较:18.9.0 < 18.10.0(字符串比较会判反)", () => {
    expect(isOutdated("18.9.0", "18.10.0")).toBe(true);
    expect(isOutdated("18.10.0", "18.9.0")).toBe(false);
  });

  it("相等/领先 → false", () => {
    expect(isOutdated("2.1.251 (Claude Code)", "2.1.251")).toBe(false);
    expect(isOutdated("0.152.0", "0.151.0")).toBe(false);
  });

  it("当前版本不可解析 → false(不误导用户点更新)", () => {
    expect(isOutdated("已安装", "18.0.12")).toBe(false);
    expect(isOutdated(null, "18.0.12")).toBe(false);
    expect(isOutdated("18.0.11", null)).toBe(false);
  });
});
