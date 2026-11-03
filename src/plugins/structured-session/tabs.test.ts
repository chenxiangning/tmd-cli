import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string }>,
  viewerAvailable: true,
  openTab: vi.fn(),
  openView: vi.fn(),
}));

vi.mock("@kernel/tabs", () => ({ getTabs: () => h.tabs, openTab: h.openTab }));
vi.mock("@kernel/host", () => ({ host: { getCliProfile: () => ({ name: "OMP" }) } }));
vi.mock("@kernel/workspace", () => ({
  getActiveWorkspace: () => undefined,
  getWorkspaces: () => [],
}));
vi.mock("@kernel/sessionViewTabs", () => ({
  isSessionViewAvailable: () => h.viewerAvailable,
  openSessionViewAtText: h.openView,
}));
vi.mock("@kernel/i18n", () => ({ t: (text: string) => text }));

import { openStructuredSessionTranscript } from "./tabs";

const TARGET = { profileId: "omp", cwd: "/repo" };

beforeEach(() => {
  h.tabs = [];
  h.viewerAvailable = true;
  vi.clearAllMocks();
});

describe("structured 历史深链", () => {
  it("原 structured tab 仍在时激活现有转录", () => {
    h.tabs = [{ id: "structured:omp:/repo" }];
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务", 2)).toBe("jumped");
    expect(h.openTab).toHaveBeenCalledOnce();
    expect(h.openView).not.toHaveBeenCalled();
  });

  it("原 tab 已关闭时打开原 CLI 磁盘转录,不新起空 RPC", () => {
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务", 2)).toBe("opened");
    expect(h.openTab).not.toHaveBeenCalled();
    expect(h.openView).toHaveBeenCalledWith(
      { profileId: "omp", cwd: "/repo", cliSessionId: "cli-1" },
      "原任务",
      2,
    );
  });

  it("原 tab 与转录查看器都不可用时如实返回 miss", () => {
    h.viewerAvailable = false;
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务")).toBe("miss");
    expect(h.openTab).not.toHaveBeenCalled();
    expect(h.openView).not.toHaveBeenCalled();
  });
});
