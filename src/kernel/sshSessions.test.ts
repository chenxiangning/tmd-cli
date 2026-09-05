/**
 * SSH 会话装配契约测试(kernel/sshSessions.ts)。
 *
 * 覆盖:创建走 sshSessionCreate(参数透传 host/cwd/workspaceId)、装配广播
 * (sessionsChanged + activeSessionChanged)、exit 清场、双订阅 await 缝隙的
 * 竞态守卫(成对退订 + 广播 sessionStartFailed + 抛出,不说谎的非空断言)。
 * ipc/workspace 注入替身,不触真实 host。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SessionMeta } from "./ipc";
import type { SshHostConfig } from "./sshTypes";

const exitCbs = new Map<string, () => void>();
const outputCbs = new Map<string, (text: string) => void>();
/** 每次订阅登记的退订函数(成对退订断言用)。 */
const offs: Mock[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sshSessionCreate: vi.fn(async () => ({ id: "ssh-1", pid: 200 })),
    sshSessionReconnect: vi.fn(async () => ({ id: "ssh-2", pid: 201 })),
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

const activeWorkspace = { id: "ws1", name: "repo", root: "/repo", createdAt: 1 };
vi.mock("./workspace", () => ({
  getWorkspaces: vi.fn(() => [activeWorkspace]),
  getActiveWorkspace: vi.fn(() => activeWorkspace),
}));

import { ipc } from "./ipc";
import { EventBus, KernelTopics } from "./events";
import { SshSessionService } from "./sshSessions";

const hostConfig: SshHostConfig = {
  id: "h1",
  name: "dev",
  host: "192.168.1.10",
  port: 22,
  username: "u",
  authType: "password",
  password: "p",
  privateKey: "",
  privateKeyPath: "",
  privateKeyPassphrase: "",
};

function mkService(findAlive: (id: string) => boolean = () => true) {
  const h = {
    refreshSessions: vi.fn(async () => {}),
    findSession: vi.fn(
      (id: string) =>
        (findAlive(id) ? { id, profileId: "ssh", cwd: "/repo" } : undefined) as
          | SessionMeta
          | undefined,
    ),
    appendOutput: vi.fn(),
    removeSession: vi.fn(async () => {}),
    trackUnlisten: vi.fn(),
    getSessions: vi.fn((): SessionMeta[] => []),
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
  return { svc: new SshSessionService(h, events), h, events, fired };
}

beforeEach(() => {
  outputCbs.clear();
  exitCbs.clear();
  offs.length = 0;
  vi.mocked(ipc.sshSessionCreate).mockClear();
  vi.mocked(ipc.sshSessionReconnect).mockClear();
});

describe("SshSessionService", () => {
  it("创建:sshSessionCreate 参数透传 + 装配广播", async () => {
    const { svc, h, fired } = mkService();
    const meta = await svc.create(hostConfig);
    expect(meta).toMatchObject({ id: "ssh-1" });
    expect(ipc.sshSessionCreate).toHaveBeenCalledWith(hostConfig, "/repo", "ws1");
    expect(h.trackUnlisten).toHaveBeenCalledWith("ssh-1", [expect.any(Function), expect.any(Function)]);
    expect(fired).toEqual([
      { topic: KernelTopics.sessionsChanged, payload: h.getSessions() },
      { topic: KernelTopics.activeSessionChanged, payload: "ssh-1" },
    ]);
  });

  it("重连形态:第一参传旧会话 id → sshSessionReconnect", async () => {
    const { svc } = mkService();
    const meta = await svc.create("ssh-old");
    expect(meta).toMatchObject({ id: "ssh-2" });
    expect(ipc.sshSessionReconnect).toHaveBeenCalledWith("ssh-old", "/repo", "ws1");
    expect(ipc.sshSessionCreate).not.toHaveBeenCalled();
  });

  it("exit 清场:removeSession + sessionExited 广播;已删会话的迟到输出不复活缓冲", async () => {
    const alive = { on: true };
    const { svc, h, fired } = mkService((id) => alive.on && id === "ssh-1");
    await svc.create(hostConfig);
    outputCbs.get("ssh-1")?.("chunk");
    expect(h.appendOutput).toHaveBeenCalledWith("ssh-1", "chunk");
    exitCbs.get("ssh-1")?.();
    expect(h.removeSession).toHaveBeenCalledWith("ssh-1");
    expect(fired.some((f) => f.topic === KernelTopics.sessionExited)).toBe(true);
    alive.on = false;
    outputCbs.get("ssh-1")?.("late");
    expect(h.appendOutput).toHaveBeenCalledTimes(1);
  });

  it("双订阅 await 缝隙被删:成对退订 + 广播 sessionStartFailed + 抛出(非空断言已消灭)", async () => {
    const { svc, h, fired } = mkService(() => false);
    await expect(svc.create(hostConfig)).rejects.toThrow("会话在装配期间被移除");
    expect(offs).toHaveLength(2);
    expect(offs.every((off) => off.mock.calls.length === 1)).toBe(true);
    expect(h.trackUnlisten).not.toHaveBeenCalled();
    expect(fired).toEqual([
      {
        topic: KernelTopics.sessionStartFailed,
        payload: expect.objectContaining({ sessionId: "ssh-1", profileId: "ssh" }),
      },
    ]);
  });
});
