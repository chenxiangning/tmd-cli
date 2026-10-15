/**
 * CLI 会话装配(adoptSpawned,自 sessionSpawn 三路径调用)契约测试。
 *
 * 覆盖:正常装配(身份/活跃指针/状态种子 + 广播)、exit 清场(onExit 钩子
 * 先于 removeSession)、双订阅 await 缝隙的竞态守卫(成对退订 + 广播
 * sessionStartFailed + 抛出,不说谎的非空断言;秒退守望集成语义见
 * host.startFailure.test.ts)。ipc 注入替身,不触真实 host。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliProfile } from "./cli";

const exitCbs = new Map<string, () => void>();
const outputCbs = new Map<string, (text: string) => void>();
/** 每次订阅登记的退订函数(成对退订断言用)。 */
const offs: Mock[] = [];
/** 可控 sessionList 返回表(竞态守卫用例返回空表)。 */
let listed: SessionMeta[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async () => ({ id: "pty-1", pid: 100 })),
    sessionList: vi.fn(async () => listed),
  },
  onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
    outputCbs.set(id, cb);
    const off = vi.fn();
    offs.push(off);
    return off;
  }),
  onPtyExit: vi.fn(async (id: string, cb: () => void) => {
    exitCbs.set(id, cb);
    const off = vi.fn();
    offs.push(off);
    return off;
  }),
}));

import { EventBus, KernelTopics } from "./events";
import { ipc } from "./ipc";
import { SessionSpawnService } from "./sessionSpawn";
import { ADOPT_RACE_REASON } from "./sessionAdopt";

const profile = {
  id: "test-cli",
  name: "test",
  command: "true",
  args: [],
  triggers: [],
} as unknown as CliProfile;

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
    getCliSessionId: vi.fn(() => undefined),
    identityTrack: vi.fn(),
    statusEnsurePolling: vi.fn(),
    statusRefresh: vi.fn(),
    statusSeed: vi.fn(),
    trackUnlisten: vi.fn(),
    outputTail: vi.fn(() => ""),
    appendOutput: vi.fn(),
    seedOutputBuffer: vi.fn(),
    removeSession: vi.fn(async () => {}),
    notify: vi.fn(),
  };
  const events = new EventBus();
  const fired: Array<{ topic: string; payload: unknown }> = [];
  for (const topic of [
    KernelTopics.sessionStartFailed,
    KernelTopics.sessionsChanged,
    KernelTopics.activeSessionChanged,
    KernelTopics.sessionExited,
  ]) {
    events.on(topic, (payload: unknown) => fired.push({ topic, payload }));
  }
  return { svc: new SessionSpawnService(h, events), h, fired };
}

beforeEach(() => {
  outputCbs.clear();
  exitCbs.clear();
  offs.length = 0;
  listed = [{ id: "pty-1", profileId: "test-cli", cwd: "/proj" } as SessionMeta];
});

describe("adoptSpawned(装配)", () => {
  it("正常装配:刷新活表 + 置 active + 广播 + 状态种子(全新会话)", async () => {
    const { svc, h, fired } = mkService();
    const meta = await svc.create("test-cli", "/proj");
    expect(meta).toMatchObject({ id: "pty-1" });
    expect(h.setActiveSessionId).toHaveBeenCalledWith("pty-1");
    expect(h.trackUnlisten).toHaveBeenCalledWith("pty-1", [expect.any(Function), expect.any(Function)]);
    expect(h.statusEnsurePolling).toHaveBeenCalled();
    expect(h.statusSeed).toHaveBeenCalledWith("pty-1");
    expect(h.bindIdentity).not.toHaveBeenCalled();
    expect(fired).toEqual([
      { topic: KernelTopics.sessionsChanged, payload: h.getSessions() },
      { topic: KernelTopics.activeSessionChanged, payload: "pty-1" },
    ]);
  });

  it("exit 清场:onExit 钩子先于 removeSession(秒退守望摘尾时序)", async () => {
    const { svc, h, fired } = mkService();
    const order: string[] = [];
    h.outputTail.mockImplementation(() => {
      order.push("tail");
      return "";
    });
    h.removeSession.mockImplementation(async () => {
      order.push("remove");
    });
    await svc.create("test-cli", "/proj");
    exitCbs.get("pty-1")?.();
    expect(order).toEqual(["tail", "remove"]);
    expect(fired.some((f) => f.topic === KernelTopics.sessionExited)).toBe(true);
  });

  it("双订阅 await 缝隙被删:成对退订 + 广播 sessionStartFailed + 抛出(非空断言已消灭)", async () => {
    listed = [];
    const { svc, h, fired } = mkService();
    await expect(svc.create("test-cli", "/proj")).rejects.toThrow(ADOPT_RACE_REASON);
    expect(offs).toHaveLength(2);
    expect(offs.every((off) => off.mock.calls.length === 1)).toBe(true);
    expect(h.trackUnlisten).not.toHaveBeenCalled();
    expect(h.statusSeed).not.toHaveBeenCalled();
    expect(fired).toEqual([
      {
        topic: KernelTopics.sessionStartFailed,
        payload: expect.objectContaining({ sessionId: "pty-1", profileId: "test-cli" }),
      },
    ]);
  });

  it("raw identityTrack:true:spawn 前快照磁盘会话并登记身份探测(spec.cwd 分区)", async () => {
    const { svc, h } = mkService();
    const listSessions = vi.fn(async () => [{ id: "old-1", modifiedAt: 7 }]);
    const withList = { ...profile, listSessions } as unknown as CliProfile;
    h.getCliProfile.mockReturnValue(withList);
    const order: string[] = [];
    listSessions.mockImplementation(async () => {
      order.push("snapshot");
      return [{ id: "old-1", modifiedAt: 7 }];
    });
    vi.mocked(ipc.sessionSpawn).mockImplementation(async () => {
      order.push("spawn");
      return { id: "pty-1", pid: 100 };
    });
    await svc.raw("test-cli", { command: "true", args: [], cwd: "/proj" }, undefined, {
      identityTrack: true,
    });
    expect(order).toEqual(["snapshot", "spawn"]); /* 快照先于 spawn:pre-spawn 旧文件不得抢绑 */
    expect(h.identityTrack).toHaveBeenCalledWith(
      "pty-1",
      "test-cli",
      "/proj",
      new Map([["old-1", 7]]),
      expect.any(Number),
    );
  });

  it("raw 缺省不探测:profile 声明 listSessions 也不登记身份(dsh host 自管身份)", async () => {
    const { svc, h } = mkService();
    const listSessions = vi.fn(async () => []);
    const withList = { ...profile, listSessions } as unknown as CliProfile;
    h.getCliProfile.mockReturnValue(withList);
    await svc.raw("test-cli", { command: "true", args: [], cwd: "/proj" });
    expect(listSessions).not.toHaveBeenCalled();
    expect(h.identityTrack).not.toHaveBeenCalled();
  });

});
