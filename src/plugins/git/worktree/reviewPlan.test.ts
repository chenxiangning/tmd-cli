import { describe, expect, it } from "vitest";
import type { GitDiffStatus, GitFileStatus } from "@kernel/ipc";
import { resolveWorktreeDelivery, resolveWorktreeReview, worktreeCompareName } from "./reviewPlan";

const DIRTY_FILE: GitFileStatus = {
  path: "src/a.ts",
  status: "M",
  staged: false,
  wt: true,
  oldPath: null,
};

function status(files: GitFileStatus[], upstream: string | null): Pick<GitDiffStatus, "files" | "upstream"> {
  return { files, upstream };
}

describe("resolveWorktreeReview", () => {
  it("脏树打开实际存在的未提交 diff 侧，混合树两侧均可达", () => {
    expect(resolveWorktreeReview(status([DIRTY_FILE], "origin/feat"), "develop")).toEqual({
      mode: "diff",
      sides: ["worktree"],
    });
    expect(resolveWorktreeReview(status([{ ...DIRTY_FILE, staged: true, wt: false }], null), "develop")).toEqual({
      mode: "diff",
      sides: ["staged"],
    });
    expect(resolveWorktreeReview(status([{ ...DIRTY_FILE, staged: true }], null), "develop")).toEqual({
      mode: "diff",
      sides: ["staged", "worktree"],
    });
  });

  it("干净树即使跟踪同名远端,也按 PR 基线比较交付内容", () => {
    expect(resolveWorktreeReview(status([], "origin/feat"), "develop")).toEqual({
      mode: "compare",
      target: "develop",
    });
  });

  it("无 upstream 使用既有比较默认值，不硬编码 main", () => {
    expect(resolveWorktreeReview(status([], null), "develop")).toEqual({
      mode: "compare",
      target: "develop",
    });
  });
});

describe("resolveWorktreeDelivery", () => {
  it("无独有提交可清理,有待交付提交时按 PR 能力分态", () => {
    expect(resolveWorktreeDelivery(0, false)).toBe("clean");
    expect(resolveWorktreeDelivery(2, true)).toBe("deliver");
    expect(resolveWorktreeDelivery(2, false)).toBe("blocked");
  });
});

describe("worktreeCompareName", () => {
  it("普通树用分支短名,detached 用 HEAD 而不是空串", () => {
    expect(worktreeCompareName({ branch: "feat", detached: false })).toBe("feat");
    expect(worktreeCompareName({ branch: "", detached: true })).toBe("HEAD");
  });
});
