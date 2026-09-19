/**
 * createSessionServices 服务装配契约测试。
 * 覆盖契约:
 * - 装配体返回 ssh/shell/spawn 三个服务实例 + readopt,均以 (ctx, events) 构造;
 * - 共享 base 回调逐项委托(会话表/输出/退订登记/notify);ssh 与 spawn 额外
 *   获得身份桥(getCliSessionId/bindIdentity),spawn 独占身份探测与状态守望回调;
 * - readopt:先 readoptSessions(base+setSessions) → 账本剪枝 pruneIdentities →
 *   仅对 cli 会话做磁盘尾取(sessionLogSize=0 跳过;256KB 页 → screenMirror.backfill
 *   + readoptAnchor),busy 现势 = 尾 16K 剥 ANSI 后按 profile.busyMarks 行级命中;
 * - 单会话补底失败不拖垮接管(readopt 整体 resolve)。
 * 服务类/sessionAdopt/ipc 全部 vi.mock(服务本体碰 Tauri,node 下不可实例化)。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createSessionServices } from "./hostSessionServices";
import { SshSessionService } from "./sshSessions";
import { ShellSessionService } from "./shellSessions";
import { SessionSpawnService } from "./sessionSpawn";
import { readoptSessions } from "./sessionAdopt";
import { ipc } from "./ipc";
import type { EventBus } from "./events";
import type { HostWatches } from "./hostWatches";
import type { CliProfile } from "./cli";
import type { SessionMeta } from "./ipc";

vi.mock("./sessionSpawn", () => ({ SessionSpawnService: vi.fn() }));
vi.mock("./shellSessions", () => ({ ShellSessionService: vi.fn() }));
vi.mock("./sshSessions", () => ({ SshSessionService: vi.fn() }));
vi.mock("./sessionAdopt", () => ({ readoptSessions: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ipc", () => ({
  ipc: { sessionLogSize: vi.fn(), sessionHistoryPage: vi.fn() },
}));

const events = { emit: vi.fn() } as unknown as EventBus;

function makeWatches(): HostWatches {
  return {
    appendOutput: vi.fn(),
    seedOutputBuffer: vi.fn(),
    getCliSessionId: vi.fn().mockReturnValue("cli-x"),
    bindIdentity: vi.fn(),
    statusEnsurePolling: vi.fn(),
    statusRefresh: vi.fn(),
    statusSeed: vi.fn(),
    outputTail: vi.fn(),
    identityTrack: vi.fn(),
    pruneIdentities: vi.fn(),
    readoptAnchor: vi.fn(),
    screenMirror: { backfill: vi.fn() },
  } as unknown as HostWatches;
}

function makeCtx(sessions: SessionMeta[] = [], profile?: CliProfile) {
  return {
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    getSessions: vi.fn().mockReturnValue(sessions),
    setSessions: vi.fn(),
    findSession: vi.fn(),
    getCliProfile: vi.fn().mockReturnValue(profile),
    setActiveSessionId: vi.fn(),
    setActiveSession: vi.fn(),
    removeSession: vi.fn().mockResolvedValue(undefined),
    trackUnlisten: vi.fn(),
    notify: vi.fn(),
  };
}

const meta = (id: string, kind?: string, profileId = "omp"): SessionMeta =>
  ({ id, ...(kind ? { kind } : {}), profileId } as SessionMeta);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("三服务装配与回调委托", () => {
  it("ssh/shell/spawn 均以 (ctx, events) 构造;spawn ctx 独占身份探测与守望回调", () => {
    const ctx = makeCtx();
    const watches = makeWatches();
    const out = createSessionServices(ctx, watches, events);
    expect(out.ssh).toBeDefined();
    expect(out.shell).toBeDefined();
    expect(out.spawn).toBeDefined();
    expect(typeof out.readopt).toBe("function");

    const [sshCtx, sshEvents] = (SshSessionService as Mock).mock.calls[0];
    expect(sshEvents).toBe(events);
    const spawnCtx = (SessionSpawnService as Mock).mock.calls[0][0] as unknown as Record<string, unknown>;
    // spawn 独占:身份探测/守望编排回调只出现在 spawn ctx,ssh 侧无
    expect(spawnCtx.identityTrack).toBeDefined();
    expect(spawnCtx.statusEnsurePolling).toBeDefined();
    expect(sshCtx).not.toHaveProperty("identityTrack");
  });

  it("base 回调逐项委托:findSession/输出双通道/退订登记/活跃指针/notify", () => {
    const ctx = makeCtx();
    const watches = makeWatches();
    createSessionServices(ctx, watches, events);
    const base = (ShellSessionService as Mock).mock.calls[0][0] as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    base.findSession("s1");
    expect(ctx.findSession).toHaveBeenCalledWith("s1");
    base.appendOutput("s1", "hi");
    expect(watches.appendOutput).toHaveBeenCalledWith("s1", "hi");
    base.seedOutputBuffer("s1", "seed");
    expect(watches.seedOutputBuffer).toHaveBeenCalledWith("s1", "seed");
    const off = () => undefined;
    base.trackUnlisten("s1", [off]);
    expect(ctx.trackUnlisten).toHaveBeenCalledWith("s1", [off]);
    base.setActiveSession("s1");
    expect(ctx.setActiveSession).toHaveBeenCalledWith("s1");
    base.notify();
    expect(ctx.notify).toHaveBeenCalled();
    expect(base.getSessions()).toBe(ctx.getSessions());
  });

  it("身份桥与身份探测回调均委托 watches/ctx:bindIdentity/getCliSessionId/identityTrack", () => {
    const ctx = makeCtx();
    const watches = makeWatches();
    createSessionServices(ctx, watches, events);
    const spawnCtx = (SessionSpawnService as Mock).mock.calls[0][0] as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    expect(spawnCtx.getCliSessionId("s1")).toBe("cli-x");
    expect(watches.getCliSessionId).toHaveBeenCalledWith("s1");
    expect(spawnCtx.getCliProfile("omp")).toBeUndefined(); // ctx 未注册 profile
    spawnCtx.bindIdentity("s1", "cli-9");
    expect(watches.bindIdentity).toHaveBeenCalledWith("s1", "cli-9");
    spawnCtx.identityTrack("s1", "omp", "/ws", null, 123);
    expect(watches.identityTrack).toHaveBeenCalledWith("s1", "omp", "/ws", null, 123);
  });
});

describe("readopt 接管", () => {
  it("cli 会话:256KB 尾取 → 镜像补底 + 守望重锚;busy 按 busyMarks 行级命中", async () => {
    const busyTail = "done\n⎋ running\nok";
    const profile = { busyMarks: [/⎋/], echoMarks: [/echo/] } as unknown as CliProfile;
    const sessions = [meta("s1", "cli"), meta("sh1", "shell")];
    const ctx = makeCtx(sessions, profile);
    const watches = makeWatches();
    vi.mocked(ipc.sessionLogSize).mockResolvedValue(4096);
    vi.mocked(ipc.sessionHistoryPage).mockResolvedValue({ text: busyTail } as never);

    const out = createSessionServices(ctx, watches, events);
    await out.readopt();

    expect(vi.mocked(readoptSessions)).toHaveBeenCalledTimes(1);
    const adoptArg = vi.mocked(readoptSessions).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(adoptArg.setSessions).toBeDefined(); // base+setSessions 注入接管
    expect(watches.pruneIdentities).toHaveBeenCalledTimes(1);

    // 仅 cli 会话做尾取;shell 会话跳过
    expect(vi.mocked(ipc.sessionLogSize)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ipc.sessionLogSize)).toHaveBeenCalledWith("s1");
    expect(vi.mocked(ipc.sessionHistoryPage)).toHaveBeenCalledWith("s1", 4096, 262144);
    expect(watches.screenMirror.backfill).toHaveBeenCalledWith("s1", busyTail);
    expect(watches.readoptAnchor).toHaveBeenCalledWith("s1", busyTail, profile.echoMarks, true);
    expect(ctx.getCliProfile).toHaveBeenCalledWith("omp");
  });

  it("无日志(0)/普通尾页 → 不补底的会话跳过;busy 不命中传 false", async () => {
    const sessions = [meta("s0", "cli"), meta("s1", "cli")];
    const ctx = makeCtx(sessions, { busyMarks: [/⎋/] } as unknown as CliProfile);
    const watches = makeWatches();
    vi.mocked(ipc.sessionLogSize).mockImplementation(async (id: string) =>
      id === "s0" ? 0 : 100,
    );
    vi.mocked(ipc.sessionHistoryPage).mockResolvedValue({ text: "plain line" } as never);

    const out = createSessionServices(ctx, watches, events);
    await out.readopt();

    expect(watches.screenMirror.backfill).not.toHaveBeenCalledWith("s0", expect.anything());
    expect(watches.readoptAnchor).not.toHaveBeenCalledWith("s0", expect.anything());
    expect(watches.screenMirror.backfill).toHaveBeenCalledWith("s1", "plain line");
    expect(watches.readoptAnchor).toHaveBeenCalledWith("s1", "plain line", undefined, false);
  });

  it("单会话补底失败被吞,readopt 整体 resolve 且剪枝照常", async () => {
    const ctx = makeCtx([meta("s1", "cli")]);
    const watches = makeWatches();
    vi.mocked(ipc.sessionLogSize).mockRejectedValue(new Error("ipc down"));
    const out = createSessionServices(ctx, watches, events);
    await expect(out.readopt()).resolves.toBeUndefined();
    expect(watches.pruneIdentities).toHaveBeenCalledTimes(1);
  });
});
