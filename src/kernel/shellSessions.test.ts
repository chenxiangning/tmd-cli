/**
 * 内置终端会话装配契约测试(kernel/shellSessions.ts)。
 *
 * 覆盖:无工作区拒 spawn(广播 sessionStartFailed + 抛出)、spawn spec 形状
 * (profileId="shell" / kind="shell" / title=shell 名 / cwd=工作区 root)、
 * exit 清场(removeSession + sessionExited 广播)、输出接线(存活守卫:
 * 已删会话的迟到输出不复活缓冲)、双订阅 await 缝隙的成对退订(漏退订 =
 * 泄漏 PTY 事件订阅)。ipc/workspace/platform 注入替身,不触真实 host。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SessionMeta } from "./ipc";
import { getActiveWorkspace } from "./workspace";

const exitCbs = new Map<string, () => void>();
const outputCbs = new Map<string, (text: string) => void>();
/** 每次订阅登记的退订函数(成对退订断言用)。 */
const offs: Mock[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async () => ({ id: "s1", pid: 100 })),
    sessionList: vi.fn(async () => []),
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

/* 平台钉住 macos:defaultShell 断言 zsh -l(纯 node 环境探测器不可靠)。 */
vi.mock("./platform", () => ({
  getPlatformKind: () => "macos",
}));

import { ipc } from "./ipc";
import { EventBus, KernelTopics } from "./events";
import { ShellSessionService } from "./shellSessions";

function mkService(findAlive: (id: string) => boolean = () => true) {
  const h = {
    refreshSessions: vi.fn(async () => {}),
    findSession: vi.fn(
      (id: string) =>
        (findAlive(id) ? { id, profileId: "shell", cwd: "/repo" } : undefined) as
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
  return { svc: new ShellSessionService(h, events), h, events, fired };
}

beforeEach(() => {
  outputCbs.clear();
  exitCbs.clear();
  offs.length = 0;
  vi.mocked(ipc.sessionSpawn).mockClear();
});

describe("ShellSessionService", () => {
  it("无工作区:不 spawn,广播 sessionStartFailed 并抛出", async () => {
    vi.mocked(getActiveWorkspace).mockReturnValueOnce(null);
    const { svc, fired } = mkService();
    await expect(svc.create()).rejects.toThrow("没有活跃工作区");
    expect(ipc.sessionSpawn).not.toHaveBeenCalled();
    expect(fired).toEqual([
      { topic: KernelTopics.sessionStartFailed, payload: expect.objectContaining({ profileId: "shell" }) },
    ]);
  });

  it("spawn spec 形状:profileId/kind/title/cwd/workspaceId + 装配广播", async () => {
    const { svc, h, fired } = mkService();
    const meta = await svc.create();
    expect(meta).toMatchObject({ id: "s1" });
    expect(ipc.sessionSpawn).toHaveBeenCalledWith(
      "shell",
      { command: "zsh", args: ["-l"], cwd: "/repo", kind: "shell", title: "zsh" },
      "ws1",
    );
    expect(h.trackUnlisten).toHaveBeenCalledWith("s1", [expect.any(Function), expect.any(Function)]);
    expect(fired).toEqual([
      { topic: KernelTopics.sessionsChanged, payload: h.getSessions() },
      { topic: KernelTopics.activeSessionChanged, payload: "s1" },
    ]);
  });

  it("exit 清场:removeSession + sessionExited 广播;已删会话的迟到输出不复活缓冲", async () => {
    const alive = { on: true };
    const { svc, h } = mkService((id) => alive.on && id === "s1");
    await svc.create();
    outputCbs.get("s1")?.("chunk");
    expect(h.appendOutput).toHaveBeenCalledWith("s1", "chunk");
    exitCbs.get("s1")?.();
    expect(h.removeSession).toHaveBeenCalledWith("s1");
    alive.on = false;
    outputCbs.get("s1")?.("late");
    expect(h.appendOutput).toHaveBeenCalledTimes(1);
  });

  it("双订阅 await 缝隙被删:成对退订 + 广播 sessionStartFailed + 抛出(非空断言已消灭)", async () => {
    const { svc, h, fired } = mkService(() => false);
    await expect(svc.create()).rejects.toThrow("会话在装配期间被移除");
    expect(offs).toHaveLength(2);
    expect(offs.every((off) => off.mock.calls.length === 1)).toBe(true);
    expect(h.trackUnlisten).not.toHaveBeenCalled();
    expect(fired).toEqual([
      {
        topic: KernelTopics.sessionStartFailed,
        payload: expect.objectContaining({ sessionId: "s1", profileId: "shell" }),
      },
    ]);
  });
});
