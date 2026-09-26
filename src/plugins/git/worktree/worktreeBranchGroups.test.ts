import { describe, expect, it } from "vitest";
import { groupBranchesByWorktree } from "./worktreeBranchGroups";
import type { GitBranchInfo } from "@kernel/ipc";
import type { WorktreeEntry } from "@kernel/ipc";

function br(name: string): GitBranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    upstream: null,
    lastCommitSha: "a",
    lastCommitSummary: "s",
    lastCommitWhen: 0,
  };
}

function wt(path: string, branch: string, extra?: Partial<WorktreeEntry>): WorktreeEntry {
  return {
    path,
    head: "abc",
    branch,
    detached: branch === "",
    bare: false,
    locked: false,
    prunable: false,
    ...extra,
  };
}

describe("groupBranchesByWorktree", () => {
  const tree = (path: string, branch: string) => [wt(path, branch)];

  it("三分区:主仓检出 / 检出于子树 / 未检出", () => {
    const worktrees = [
      wt("/repo/main", "main"),
      ...tree("/repo/wt-demo", "wt/demo"),
      wt("/other/yokohama", "chenxiangning/yokohama"),
    ];
    const locals = [br("main"), br("wt/demo"), br("chenxiangning/yokohama"), br("ccdemo"), br("123")];
    const g = groupBranchesByWorktree(locals, worktrees, "/repo/wt-demo");
    expect(g.main.map((b) => b.name)).toEqual(["main"]);
    expect(g.byTree).toHaveLength(2);
    expect(g.byTree[0]).toMatchObject({ branch: "wt/demo", current: true });
    expect(g.byTree[0].branches.map((b) => b.name)).toEqual(["wt/demo"]);
    expect(g.byTree[1].current).toBe(false);
    expect(g.free.map((b) => b.name)).toEqual(["ccdemo", "123"]);
  });

  it("cwd 尾斜杠与反斜杠归一后判当前", () => {
    const worktrees = [wt("C:\\repo\\main", "main"), ...tree("C:\\repo\\wt-demo", "wt/demo")];
    const g = groupBranchesByWorktree([br("wt/demo")], worktrees, "C:\\repo\\wt-demo\\");
    expect(g.byTree[0]?.current).toBe(true);
  });

  it("detached 与 bare 树不成组,其分支落未检出", () => {
    const worktrees = [
      wt("/repo/main", "main"),
      wt("/repo/det", "", { detached: true }),
      wt("/repo/bare", "", { bare: true }),
    ];
    const g = groupBranchesByWorktree([br("main"), br("lonely")], worktrees, "/repo/main");
    expect(g.byTree).toHaveLength(0);
    expect(g.main.map((b) => b.name)).toEqual(["main"]);
    expect(g.free.map((b) => b.name)).toEqual(["lonely"]);
  });

  it("空 worktree 列表:全部落主仓组兜底(不丢分支)", () => {
    const g = groupBranchesByWorktree([br("a"), br("b")], [], "/x");
    expect(g.main.map((b) => b.name)).toEqual(["a", "b"]);
    expect(g.free).toHaveLength(0);
  });

  it("同名分支只进一组(归属唯一)", () => {
    const worktrees = [wt("/repo/main", "main"), ...tree("/repo/wt", "main")];
    const g = groupBranchesByWorktree([br("main")], worktrees, "/repo/main");
    expect(g.main).toHaveLength(1);
    expect(g.byTree[0]?.branches ?? []).toHaveLength(0);
  });
});
