/**
 * latestVersion 单元测试 —— 守住四个可观察契约:
 * 1. extractSemver:从各 CLI 真实 --version 输出格式里抠三元组;
 * 2. isOutdated:数值比较(非字符串比较,"9.x" < "10.x"),不可解析不误报;
 * 3. isBelowFloor:依赖版本下限比较(omp → bun ≥1.4.4),同口径不误报;
 * 4. pickStableVersions:滤 prerelease、semver 降序、截前 limit 个。
 */

import { describe, expect, it } from "vitest";
import { extractSemver, isBelowFloor, isOutdated, pickStableVersions } from "./latestVersion";

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

describe("isBelowFloor(依赖版本下限,如 omp → bun ≥1.4.4)", () => {
  it("低于下限 → true(含数值比较 1.9.0 < 1.10.0)", () => {
    expect(isBelowFloor("1.4.0", "1.4.4")).toBe(true);
    expect(isBelowFloor("1.9.0", "1.10.0")).toBe(true);
  });

  it("等于/高于下限 → false", () => {
    expect(isBelowFloor("1.4.4", "1.4.4")).toBe(false);
    expect(isBelowFloor("1.5.0", "1.4.4")).toBe(false);
  });

  it("任一无法解析/缺省 → false(不误报过旧)", () => {
    expect(isBelowFloor("已安装", "1.4.4")).toBe(false);
    expect(isBelowFloor(null, "1.4.4")).toBe(false);
    expect(isBelowFloor("1.4.0", undefined)).toBe(false);
    expect(isBelowFloor("1.4.0", "1.4")).toBe(false);
  });
});


describe("pickStableVersions", () => {
  it("滤掉 prerelease(带 - 的 tag)", () => {
    expect(
      pickStableVersions(["18.1.22", "19.0.0-beta.1", "19.0.0-rc.2", "18.1.21"]),
    ).toEqual(["18.1.22", "18.1.21"]);
  });

  it("semver 数值降序(非字符串序)", () => {
    expect(pickStableVersions(["18.9.0", "18.10.0", "9.99.0", "18.10.1"])).toEqual([
      "18.10.1",
      "18.10.0",
      "18.9.0",
      "9.99.0",
    ]);
  });

  it("只留前 limit(默认 10)个", () => {
    const many = Array.from({ length: 15 }, (_, i) => `1.${i}.0`);
    const picked = pickStableVersions(many);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe("1.14.0");
    expect(picked[9]).toBe("1.5.0");
  });
});