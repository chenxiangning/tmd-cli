/**
 * WSL 来源贡献回归 —— 新建会话菜单的引擎行过滤(2026-09-12 验收裁决:
 * 未检出发行之可用引擎时不显示不可用的 CLI;探测后只列检出行)。
 * 探针缓存是模块级 Map:本文件进程内新鲜 import,首测即「未探测」态。
 */

import { describe, expect, it } from "vitest";
import { buildWslWorkspaceOrigin } from "./contributions";
import { rememberWslProbes } from "./wslCore";
import type { Workspace } from "@kernel/workspace";
import type { CliProfile } from "@kernel/cli";

const workspace: Workspace = {
  id: "w1",
  name: "cxn",
  root: "~/cxn",
  createdAt: 0,
  wsl: { distro: "Ubuntu", hostId: "ssh-x" },
};

const profile = (id: string, command: string) =>
  ({ id, name: id, command }) as CliProfile;
const profiles = [
  profile("omp", "omp"),
  profile("pi", "pi"),
  profile("claude", "claude"),
  profile("codex", "codex"),
];

const origin = buildWslWorkspaceOrigin({
  label: "WSL 发行版",
  component: () => null,
});

describe("wsl origin 新建会话菜单", () => {
  it("未探测 = 不显示任何引擎行,note 引导去 WSL 卡检测", () => {
    expect(origin.filterCliProfiles?.(workspace, profiles)).toEqual([]);
    expect(origin.sessionMenuNote?.(workspace)).toBe(
      "未探测 Ubuntu 引擎;展开 WSL 卡检测发行版后可新建会话",
    );
  });

  it("探测后 = 只列检出的引擎,note 消失", () => {
    rememberWslProbes("Ubuntu", ["omp", "pi", "claude"]);
    expect(
      origin.filterCliProfiles?.(workspace, profiles).map((p) => p.id),
    ).toEqual(["omp", "pi", "claude"]);
    expect(origin.sessionMenuNote?.(workspace)).toBeNull();
  });

  it("探测成功但零检出 = 空列表 + 未检出 note", () => {
    rememberWslProbes("Ubuntu", []);
    expect(origin.filterCliProfiles?.(workspace, profiles)).toEqual([]);
    expect(origin.sessionMenuNote?.(workspace)).toBe(
      "Ubuntu 内未检出任何引擎",
    );
  });

  it("非 WSL 工作区不过滤不提示", () => {
    const local: Workspace = { id: "w2", name: "repo", root: "/tmp/repo", createdAt: 0 };
    expect(origin.filterCliProfiles?.(local, profiles)).toEqual(profiles);
    expect(origin.sessionMenuNote?.(local)).toBeNull();
  });
});
