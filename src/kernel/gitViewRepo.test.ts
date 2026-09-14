/**
 * gitViewRepo 跨层契约单测(node 环境纯逻辑):
 * 多仓工作区顶栏分支 label 的取数源决策 + store 幂等写。
 * 背景(2026-09-15 实证 bug):多仓工作区根常非仓,label 必须跟随
 * GitPanel 解析出的选中仓,否则显示滞留的上个工作区分支或空白。
 */

import { describe, expect, it } from "vitest";
import { getGitViewRepo, resolveBranchCwd, setGitViewRepo } from "./gitViewRepo";

describe("resolveBranchCwd", () => {
  const root = "/ws/GUANJIA";

  it("无写入(null)→ 回退工作区根", () => {
    expect(resolveBranchCwd(null, "w2", root)).toBe(root);
  });

  it("工作区不匹配(切工作区残留)→ 回退根,不串仓", () => {
    expect(resolveBranchCwd({ workspaceId: "w1", cwd: "/other/repo" }, "w2", root)).toBe(root);
  });

  it("面板未解析出仓(guide 档 cwd null)→ 回退根", () => {
    expect(resolveBranchCwd({ workspaceId: "w2", cwd: null }, "w2", root)).toBe(root);
  });

  it("匹配且有选中仓 → 用选中仓(多仓跟随面板)", () => {
    expect(resolveBranchCwd({ workspaceId: "w2", cwd: "/ws/GUANJIA/auth" }, "w2", root)).toBe(
      "/ws/GUANJIA/auth",
    );
  });
});

describe("setGitViewRepo 幂等", () => {
  it("同值不换快照引用,异值更新", () => {
    setGitViewRepo({ workspaceId: "wx", cwd: "/a" });
    const snap = getGitViewRepo();
    setGitViewRepo({ workspaceId: "wx", cwd: "/a" });
    expect(getGitViewRepo()).toBe(snap);
    setGitViewRepo({ workspaceId: "wx", cwd: "/b" });
    expect(getGitViewRepo()).not.toBe(snap);
    expect(getGitViewRepo()?.cwd).toBe("/b");
  });
});
