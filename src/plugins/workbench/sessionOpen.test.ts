/**
 * openLink 打开路径契约:用户手势声明(摘最大化信号)先行;
 * 终结 host 关联凭留存 CLI 磁盘身份 resume;无身份不猜测,回落提示。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const hostMock = vi.hoisted(() => ({
  host: {
    getSessions: vi.fn((): Array<{ id: string; title: string }> => []),
    getCliSessionId: vi.fn(() => undefined),
    openDiskSession: vi.fn(async () => ({ id: "resumed" })),
    setActiveSession: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn(() => () => undefined) },
  },
}));
vi.mock("@kernel/host", () => hostMock);

import { openLink } from "./sessionOpen";
import type { Project, ProjectTask } from "./types";

const project = {
  id: "p1", name: "P", cwd: "/tmp/proj", tasks: [],
} as unknown as Project;
const onToast = vi.fn();
const link = (over: Partial<ProjectTask["sessions"][number]>) =>
  ({ kind: "host", ref: "dead-pty", profileId: "claude", title: "测试", createdAt: "2026-10-10T00:00:00Z", ...over }) as ProjectTask["sessions"][number];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("workbench openLink", () => {
  it("任何点击先广播 view 请求(遮盖统一:最大化态下打开必须可见)", () => {
    openLink(link({ cliSessionId: "disk-9" }), project, "ws1", onToast);
    expect(hostMock.host.events.emit).toHaveBeenCalledWith("kernel.sessions.viewRequested", null);
  });

  it("活会话命中注册表:聚焦,不开新 PTY", () => {
    hostMock.host.getSessions.mockReturnValue([{ id: "live-1", title: "测试" }]);
    openLink(link({ ref: "live-1" }), project, "ws1", onToast);
    expect(hostMock.host.setActiveSession).toHaveBeenCalledWith("live-1");
    expect(hostMock.host.openDiskSession).not.toHaveBeenCalled();
  });

  it("终结 host 关联 + 留存磁盘身份:按身份 resume", () => {
    openLink(link({ cliSessionId: "disk-9" }), project, "ws1", onToast);
    expect(hostMock.host.openDiskSession).toHaveBeenCalledWith("claude", "/tmp/proj", "ws1", "disk-9");
    expect(onToast).not.toHaveBeenCalled();
  });

  it("终结 host 关联 + 无留存身份:不猜测,提示重关联", () => {
    openLink(link({}), project, "ws1", onToast);
    expect(hostMock.host.openDiskSession).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("会话已结束,可从列表移除后重新关联");
  });

  it("旧关联无身份:创建时刻邻近唯一命中,标题不同名也按行自身 profile resume", () => {
    const row = (n: string, profileId = "claude", createdAtOffset = 60_000) =>
      ({ key: n, profileId, profileName: profileId, cliSessionId: n, title: n, modifiedAt: 1, disk: { id: n, modifiedAt: 1, path: "/x", createdAt: Date.parse("2026-10-10T00:00:00Z") + createdAtOffset } });
    const recent = { rows: [row("disk-old", "codex")], failed: false, reload: () => undefined } as unknown as Parameters<typeof openLink>[4];
    openLink(link({ title: "项目分析" }), project, "ws1", onToast, recent);
    expect(hostMock.host.openDiskSession).toHaveBeenCalledWith("codex", "/tmp/proj", "ws1", "disk-old");
    expect(onToast).not.toHaveBeenCalled();
  });

  it("旧关联无身份且邻近命中多个:歧义不赌,提示手动打开", () => {
    const mk = (n: string, profileId = "claude") =>
      ({ key: n, profileId, profileName: profileId, cliSessionId: n, title: n, modifiedAt: 1, disk: { id: n, modifiedAt: 1, path: "/x", createdAt: Date.parse("2026-10-10T00:00:00Z") + 30_000 } });
    const recent = { rows: [mk("disk-a"), mk("disk-b", "codex")], failed: false, reload: () => undefined } as unknown as Parameters<typeof openLink>[4];
    openLink(link({}), project, "ws1", onToast, recent);
    expect(hostMock.host.openDiskSession).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("未找到原会话,请从侧栏手动打开");
  });

  it("旧关联无身份且既不同名也不同刻:仍提示重关联", () => {
    const recent = { rows: [{ key: "k", profileId: "claude", profileName: "Claude", cliSessionId: "disk-far", title: "别的会话", modifiedAt: 1, disk: { id: "disk-far", modifiedAt: 1, path: "/x", createdAt: Date.parse("2026-10-01T00:00:00Z") } }], failed: false, reload: () => undefined } as unknown as Parameters<typeof openLink>[4];
    openLink(link({}), project, "ws1", onToast, recent);
    expect(hostMock.host.openDiskSession).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("会话已结束,可从列表移除后重新关联");
  });

  it("disk 关联:直接按 ref resume", () => {
    openLink(link({ kind: "disk", ref: "disk-7" }), project, "ws1", onToast);
    expect(hostMock.host.openDiskSession).toHaveBeenCalledWith("claude", "/tmp/proj", "ws1", "disk-7");
  });

  it("项目未绑定目录的 disk 关联:提示,不开会话", () => {
    openLink(link({ kind: "disk", ref: "disk-7" }), { ...project, cwd: undefined }, "ws1", onToast);
    expect(hostMock.host.openDiskSession).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("项目未绑定目录,无法恢复磁盘会话");
  });
});
