/**
 * openDiskSession 插件接管分支(profile.acquireResume)契约测试。
 *
 * 覆盖:命中接管(不 spawn / replayTail 预灌输出缓冲 / 身份绑定 / 置 active)、
 * null 与抛错均降级默认冷路径、未声明钩子零影响。ipc 注入替身,不触真实 host。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliProfile } from "./cli";

const exitCbs = new Map<string, () => void>();
const outputCbs = new Map<string, (text: string) => void>();
let listed: SessionMeta[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async () => ({ id: "cold-1", pid: 200 })),
    sessionList: vi.fn(async () => listed),
    sessionSetWorkspace: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
    outputCbs.set(id, cb);
    return () => outputCbs.delete(id);
  }),
  onPtyExit: vi.fn(async (id: string, cb: () => void) => {
    exitCbs.set(id, cb);
    return () => exitCbs.delete(id);
  }),
}));

import { EventBus } from "./events";
import { SessionSpawnService } from "./sessionSpawn";

let acquireResume: Mock;
let profile: CliProfile;

function mkService() {
  let table: SessionMeta[] = [];
  const h = {
    getCliProfile: vi.fn(() => profile),
    getSessions: vi.fn(() => table),
    setSessions: vi.fn((sessions: SessionMeta[]) => {
      table = sessions;
    }),
    findSession: vi.fn((id: string) => table.find((s) => s.id === id)),
    setActiveSessionId: vi.fn(),
    setActiveSession: vi.fn(),
    bindIdentity: vi.fn(() => true),
    getCliSessionId: vi.fn(),
    identityTrack: vi.fn(),
    statusEnsurePolling: vi.fn(),
    statusRefresh: vi.fn(),
    statusSeed: vi.fn(),
    trackUnlisten: vi.fn(),
    outputTail: vi.fn(() => ""),
    appendOutput: vi.fn(),
    seedOutputBuffer: vi.fn(),
    removeSession: vi.fn(async () => undefined),
    notify: vi.fn(),
  };
  const events = new EventBus();
  return { service: new SessionSpawnService(h, events), h, events };
}

beforeEach(() => {
  exitCbs.clear();
  outputCbs.clear();
  listed = [
    { id: "pre-1", profileId: "test-cli", cwd: "/w" },
    { id: "cold-1", profileId: "test-cli", cwd: "/w" },
  ];
  acquireResume = vi.fn();
  profile = {
    id: "test-cli",
    name: "test",
    command: "true",
    args: [],
    triggers: [],
    resumeArgs: () => ["--resume", "sess-9"],
    acquireResume: acquireResume as CliProfile["acquireResume"],
  } as unknown as CliProfile;
});

describe("openDiskSession acquireResume 接管分支", () => {
  it("命中:不 spawn,replayTail 经 seed 预灌(不进守望主链),补写 workspaceId,身份绑定并置 active", async () => {
    acquireResume.mockResolvedValue({ sessionId: "pre-1", replayTail: "WELCOME+RESUMED" });
    const { service, h } = mkService();
    const meta = await service.open("test-cli", "/w", "ws-7", "sess-9");
    expect(meta.id).toBe("pre-1");
    /* seed(纯存储)而非 appendOutput(守望主链):磁盘回放红线同律 */
    expect(h.seedOutputBuffer).toHaveBeenCalledWith("pre-1", "WELCOME+RESUMED");
    expect(h.appendOutput).not.toHaveBeenCalled();
    const { ipc } = await import("./ipc");
    expect(ipc.sessionSetWorkspace).toHaveBeenCalledWith("pre-1", "ws-7");
    expect(ipc.sessionSpawn).not.toHaveBeenCalled();
    expect(h.bindIdentity).toHaveBeenCalledWith("pre-1", "sess-9");
    expect(h.setActiveSessionId).toHaveBeenCalledWith("pre-1");
    expect(h.statusRefresh).toHaveBeenCalledWith("pre-1");
  });

  it("接管分支 sessionSetWorkspace 失败不阻断(workspaceId 缺行但不损数据)", async () => {
    acquireResume.mockResolvedValue({ sessionId: "pre-1", replayTail: "x" });
    const { ipc } = await import("./ipc");
    vi.mocked(ipc.sessionSetWorkspace).mockRejectedValueOnce(new Error("gone"));
    const { service } = mkService();
    const meta = await service.open("test-cli", "/w", "ws-7", "sess-9");
    expect(meta.id).toBe("pre-1");
  });

  it("钩子返回 null:降级默认冷路径(spawn + resumeArgs)", async () => {
    acquireResume.mockResolvedValue(null);
    const { service } = mkService();
    const meta = await service.open("test-cli", "/w", undefined, "sess-9");
    expect(meta.id).toBe("cold-1");
    expect(acquireResume).toHaveBeenCalledWith("/w", "sess-9");
  });

  it("钩子抛错:静默降级冷路径", async () => {
    acquireResume.mockRejectedValue(new Error("boom"));
    const { service } = mkService();
    const meta = await service.open("test-cli", "/w", undefined, "sess-9");
    expect(meta.id).toBe("cold-1");
  });

  it("未声明钩子:零影响冷路径", async () => {
    delete (profile as { acquireResume?: unknown }).acquireResume;
    const { service } = mkService();
    const meta = await service.open("test-cli", "/w", undefined, "sess-9");
    expect(meta.id).toBe("cold-1");
  });

  it("空 replayTail 不灌缓冲(接管即空的极端形态)", async () => {
    acquireResume.mockResolvedValue({ sessionId: "pre-1", replayTail: "" });
    const { service, h } = mkService();
    const meta = await service.open("test-cli", "/w", undefined, "sess-9");
    expect(meta.id).toBe("pre-1");
    expect(h.seedOutputBuffer).not.toHaveBeenCalled();
  });
});
