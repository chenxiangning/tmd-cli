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
