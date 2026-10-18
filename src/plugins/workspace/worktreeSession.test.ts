import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ live: [] as Array<{ id: string; cwd: string }> }));
vi.mock("@kernel/host", () => ({
  host: {
    getSessions: () => state.live,
    findSession: (id: string) => state.live.find((s) => s.id === id),
  },
}));

/* node 环境无 localStorage,装内存桩供映射读写 */
const mem: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => void (mem[k] = v),
});

import { bumpBranch, countSessionsForWtPath, finalBranchName, recordWtSession, wtSessionOf } from "./worktreeSession";

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

describe("countSessionsForWtPath 按活会话 cwd 计数", () => {
  it("只数 cwd 落在该 worktree 的活会话(尾斜杠归一)", () => {
    state.live = [
      { id: "pty-1", cwd: "/repo/wt-A" },
      { id: "pty-2", cwd: "/repo/wt-A/" },
      { id: "pty-3", cwd: "/repo" },
    ];
    expect(countSessionsForWtPath("/repo/wt-A")).toBe(2);
  });

  it("已关会话不计:映射残留的死 id 不再虚高(移除闸误拦回归)", () => {
    state.live = [];
    recordWtSession("pty-9", { branch: "wt/x", wtPath: "/repo/wt-A", root: "/repo" });
    expect(countSessionsForWtPath("/repo/wt-A")).toBe(0);
  });

  it("无映射记录的活会话也计(终端/普通 spawn 落在 worktree)", () => {
    state.live = [{ id: "shell-1", cwd: "/repo/wt-B" }];
    expect(countSessionsForWtPath("/repo/wt-B")).toBe(1);
  });
});

describe("wtSessionOf 活会话复核", () => {
  it("活会话 cwd 与记录一致才返回", () => {
    state.live = [{ id: "pty-1", cwd: "/repo/wt-A" }];
    recordWtSession("pty-1", { branch: "wt/a", wtPath: "/repo/wt-A", root: "/repo" });
    expect(wtSessionOf("pty-1")?.branch).toBe("wt/a");
  });

  it("id 被复用且实跑 cwd 不符(残留记录)或会话已关,均不返回", () => {
    state.live = [{ id: "pty-1", cwd: "/repo" }];
    expect(wtSessionOf("pty-1")).toBeUndefined();
    expect(wtSessionOf("pty-404")).toBeUndefined();
  });
});
