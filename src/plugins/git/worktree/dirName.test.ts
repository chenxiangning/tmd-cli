import { describe, expect, it } from "vitest";
import { dirNameFromBranch, validateDirName, worktreePathFor } from "./dirName";

describe("dirNameFromBranch", () => {
  it("斜杠与点号转连字符;连续连字符合并", () => {
    expect(dirNameFromBranch("feature/x")).toBe("feature-x");
    expect(dirNameFromBranch("release/v1.2")).toBe("release-v1.2");
    expect(dirNameFromBranch("a//b")).toBe("a-b");
  });

  it("空白与 Windows 保留符转义;首尾连字符剥除", () => {
    expect(dirNameFromBranch("  my branch ")).toBe("my-branch");
    expect(dirNameFromBranch("a:b*c")).toBe("a-b-c");
    expect(dirNameFromBranch("-lead-")).toBe("lead");
  });
});

describe("validateDirName", () => {
  it("空/点开头/非法字符报错,常规名放行", () => {
    expect(validateDirName("")).toBe("目录名不能为空");
    expect(validateDirName(".hidden")).toBe("目录名不能以点开头");
    expect(validateDirName("..")).toBe("目录名不能以点开头");
    expect(validateDirName("a/b")).toContain("非法");
    expect(validateDirName("feature-x")).toBeNull();
  });
});

describe("worktreePathFor", () => {
  it("取 cwd 父目录拼接,双分隔符安全", () => {
    expect(worktreePathFor("/repo/main", "wt")).toBe("/repo/wt");
    expect(worktreePathFor("/repo/main/", "wt")).toBe("/repo/wt");
    expect(worktreePathFor("C:\\repo\\main", "wt")).toBe("C:\\repo/wt");
  });

  it("盘根仓库无父目录:返回 null(UI 报错,不嵌进主仓)", () => {
    expect(worktreePathFor("/repo", "wt")).toBeNull();
  });
});
