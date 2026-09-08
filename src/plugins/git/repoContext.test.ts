/**
 * repoContext 契约测试 —— 多仓模式分档(spec 2026-09-07-git-multi-repo-design §3)。
 * 覆盖 0/1/N 仓 × root 仓/非仓 四象限 + 记忆选中态校验;
 * 红线:单仓档(selectedPath = root 且零新 UI 开关)与现状行为逐项一致。
 */

import { describe, expect, it } from "vitest";
import { resolveRepoContext } from "./repoContext";
import type { GitRepoSummary } from "@kernel/ipc";

function repo(path: string, overrides: Partial<GitRepoSummary> = {}): GitRepoSummary {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return { path, name, branch: "main", kind: "repo", ...overrides };
}

describe("resolveRepoContext", () => {
  it("空档:无 root 或无仓 → 现状空态(无引导)", () => {
    expect(resolveRepoContext(null, [], null)).toEqual({
      mode: "empty",
      selectedPath: null,
      showRepoBar: false,
    });
    expect(resolveRepoContext("/ws", [], null).mode).toBe("empty");
    expect(resolveRepoContext("/ws", [], "/ws/remembered").selectedPath).toBeNull();
  });

  it("单仓档:root 是仓且仅此一仓 → selectedPath = root,零新 UI(回归红线)", () => {
    const c = resolveRepoContext("/ws", [repo("/ws")], null);
    expect(c).toEqual({ mode: "single", selectedPath: "/ws", showRepoBar: false });
    // 记忆失效回退 root
    expect(resolveRepoContext("/ws", [repo("/ws")], "/ws/gone").selectedPath).toBe("/ws");
  });

  it("多仓档:root 是仓且嵌套 ≥2 → 默认选中 root,记忆有效则沿用", () => {
    const repos = [repo("/ws"), repo("/ws/sub")];
    expect(resolveRepoContext("/ws", repos, null)).toEqual({
      mode: "multi",
      selectedPath: "/ws",
      showRepoBar: true,
    });
    expect(resolveRepoContext("/ws", repos, "/ws/sub").selectedPath).toBe("/ws/sub");
    // 记忆指向已消失的仓 → 回退 root
    expect(resolveRepoContext("/ws", repos, "/ws/deleted").selectedPath).toBe("/ws");
  });

  it("引导档:root 非仓且有子仓 → 未选时引导,点选后面板 + (≥2 时)切换条", () => {
    const two = [repo("/ws/a"), repo("/ws/b")];
    expect(resolveRepoContext("/ws", two, null)).toEqual({
      mode: "guide",
      selectedPath: null,
      showRepoBar: false,
    });
    expect(resolveRepoContext("/ws", two, "/ws/b")).toEqual({
      mode: "multi",
      selectedPath: "/ws/b",
      showRepoBar: true,
    });
    // 单个子仓:点选后有面板,但无切换条
    expect(resolveRepoContext("/ws", [repo("/ws/a")], "/ws/a")).toEqual({
      mode: "multi",
      selectedPath: "/ws/a",
      showRepoBar: false,
    });
  });

  it("root 仓判定用路径等值:root 不在结果首(非仓)不误判为单仓", () => {
    // root 非仓但记忆有效 → 直接进面板;root 非仓无记忆 → 引导
    const repos = [repo("/ws/a"), repo("/ws/a/deep", { kind: "submodule" })];
    expect(resolveRepoContext("/ws", repos, null).mode).toBe("guide");
    expect(resolveRepoContext("/ws", repos, "/ws/a/deep").selectedPath).toBe("/ws/a/deep");
  });
});
