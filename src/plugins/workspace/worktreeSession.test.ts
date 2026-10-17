import { describe, expect, it } from "vitest";
import { bumpBranch, finalBranchName } from "./worktreeSession";

describe("bumpBranch 冲突递增", () => {
  it("未被占用原样返回", () => {
    expect(bumpBranch("wt/fix-login", new Set(["wt/other"]))).toBe("wt/fix-login");
  });

  it("已占用递增 -2,-3", () => {
    const taken = new Set(["wt/fix", "wt/fix-2"]);
    expect(bumpBranch("wt/fix", taken)).toBe("wt/fix-3");
  });

  it("空隙不回填(-2 缺失时仍取最小可用)", () => {
    const taken = new Set(["wt/fix", "wt/fix-3"]);
    expect(bumpBranch("wt/fix", taken)).toBe("wt/fix-2");
  });
});

describe("finalBranchName 前缀 + 递增组合", () => {
  it("裸名加 wt/ 前缀,冲突再递增", () => {
    expect(finalBranchName("fix", new Set())).toBe("wt/fix");
    expect(finalBranchName("fix", new Set(["wt/fix"]))).toBe("wt/fix-2");
  });

  it("自带命名空间透传后递增", () => {
    expect(finalBranchName("feature/x", new Set(["feature/x"]))).toBe("feature/x-2");
  });
});
