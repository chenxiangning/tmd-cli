/**
 * 启动补扫契约:45s 一次性触发、仅本地工作区(origin 命中 = 远程/SSH 跳过)、
 * 前台在途扫描让路、删除数仅记数。扫描+清扫核心归 sessionSweep 测,此处只锁
 * 补扫自己的筛选与调度面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { Workspace } from "@kernel/workspace";

const mocks = vi.hoisted(() => ({
  getWorkspaces: vi.fn<() => Workspace[]>(() => []),
  findWorkspaceOrigin: vi.fn<(ws: Workspace) => unknown>(() => null),
  scanAndSweep: vi.fn<(opts: {
    profile: CliProfile;
    workspace: Workspace;
    allowDelete: boolean;
  }) => Promise<number>>(async () => 0),
  getCliProfiles: vi.fn<() => CliProfile[]>(() => []),
  inflight: new Set<string>(),
}));

vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: mocks.getCliProfiles,
    getSessions: vi.fn(() => []),
    getCliSessionId: vi.fn(() => undefined),
  },
}));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: mocks.getWorkspaces,
  workspacesReady: Promise.resolve(),
}));
vi.mock("@kernel/workspaceOrigins", () => ({
  findWorkspaceOrigin: mocks.findWorkspaceOrigin,
}));
vi.mock("./sessionSweep", () => ({
  scanAndSweep: mocks.scanAndSweep,
}));
vi.mock("./useCliDiskScan", () => ({
  foregroundScansInflight: mocks.inflight,
}));

import { bootSweepLocalWorkspaces, scheduleBootSweep } from "./hygieneBootSweep";

const ws = (id: string) => ({ id, root: `/repo/${id}` }) as Workspace;
const prof = (id: string, hasList = true) =>
  ({ id, listSessions: hasList ? vi.fn() : undefined }) as unknown as CliProfile;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inflight.clear();
  mocks.findWorkspaceOrigin.mockReturnValue(null);
  mocks.scanAndSweep.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bootSweepLocalWorkspaces", () => {
  it("远程/SSH 工作区跳过,仅本地逐区清扫(顺序不并行)", async () => {
    const local1 = ws("ws1");
    const remote = ws("ws2");
    const local2 = ws("ws3");
    mocks.getWorkspaces.mockReturnValue([local1, remote, local2]);
    mocks.findWorkspaceOrigin.mockImplementation((w) => (w === remote ? { id: "wsl" } : null));
    const p = prof("omp");
    mocks.getCliProfiles.mockReturnValue([p]);
    let pending: ((v: number) => void) | undefined;
    mocks.scanAndSweep.mockImplementation(
      () => new Promise<number>((resolve) => (pending = resolve)),
    );

    const run = bootSweepLocalWorkspaces();
    /* 顺序逐区:第一区未结算前不得推进到第三区 */
    await vi.waitFor(() => expect(mocks.scanAndSweep).toHaveBeenCalledTimes(1));
    expect(mocks.scanAndSweep.mock.calls[0]![0]).toMatchObject({ workspace: local1, profile: p });
    pending!(1);
    await vi.waitFor(() => expect(mocks.scanAndSweep).toHaveBeenCalledTimes(2));
    expect(mocks.scanAndSweep.mock.calls[1]![0]).toMatchObject({ workspace: local2 });
    pending!(0);
    await expect(run).resolves.toBe(1);
    /* 远程工作区从未进入扫描 */
    expect(mocks.scanAndSweep).not.toHaveBeenCalledWith(
      expect.objectContaining({ workspace: remote }),
    );
  });

  it("前台在途的 (工作区, CLI) 让路,其余照扫", async () => {
    mocks.getWorkspaces.mockReturnValue([ws("ws1"), ws("ws2")]);
    const p = prof("omp");
    mocks.getCliProfiles.mockReturnValue([p]);
    mocks.inflight.add("ws1:omp");
    await bootSweepLocalWorkspaces();
    expect(mocks.scanAndSweep).toHaveBeenCalledTimes(1);
    expect(mocks.scanAndSweep.mock.calls[0]![0]).toMatchObject({ workspace: { id: "ws2" } });
  });

  it("无 listSessions 的 profile 跳过;多区删除数求和仅记数", async () => {
    mocks.getWorkspaces.mockReturnValue([ws("ws1"), ws("ws2")]);
    mocks.getCliProfiles.mockReturnValue([prof("bare", false), prof("omp")]);
    mocks.scanAndSweep.mockResolvedValue(3);
    await expect(bootSweepLocalWorkspaces()).resolves.toBe(6);
    /* bare 无扫描能力:两区都只跑 omp 一轮 */
    expect(mocks.scanAndSweep).toHaveBeenCalledTimes(2);
    for (const call of mocks.scanAndSweep.mock.calls) {
      expect(call[0]).toMatchObject({ profile: { id: "omp" }, allowDelete: true });
    }
  });
});

describe("scheduleBootSweep", () => {
  it("启动后 45s 一次性补扫;取消函数生效", async () => {
    vi.useFakeTimers();
    mocks.getWorkspaces.mockReturnValue([ws("ws1")]);
    mocks.getCliProfiles.mockReturnValue([prof("omp")]);
    const cancel = scheduleBootSweep();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(mocks.scanAndSweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.scanAndSweep).toHaveBeenCalledTimes(1);
    /* 一次性:再等不重跑 */
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.scanAndSweep).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("取消函数在触发前拔出:不再补扫", async () => {
    vi.useFakeTimers();
    mocks.getCliProfiles.mockReturnValue([prof("omp")]);
    const cancel = scheduleBootSweep();
    cancel();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mocks.scanAndSweep).not.toHaveBeenCalled();
  });
});
