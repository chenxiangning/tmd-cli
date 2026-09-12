/**
 * readoptSessions 行为契约(webview 重载后活 PTY 重新接管):
 * - Rust 注册表合并入会话表 + 缺失会话重建常驻订阅(输出/退出成对);
 * - 已在表会话跳过;Rust 空表零操作;并发双调收口单次(StrictMode 双 boot);
 * - activate:false 不抢 tab(不广播 activeSessionChanged);
 * - 重建的退出监听命中 removeSession 清场。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  sessionList: vi.fn(),
  onPtyOutput: vi.fn(),
  onPtyExit: vi.fn(),
}));

vi.mock("./ipc", () => ({
  ipc: { sessionList: ipcMocks.sessionList },
  onPtyOutput: ipcMocks.onPtyOutput,
  onPtyExit: ipcMocks.onPtyExit,
}));

import { readoptSessions, type ReadoptHost } from "./sessionAdopt";
import { EventBus, KernelTopics } from "./events";
import type { SessionMeta } from "./ipc";

/** 捕获的退出回调(触发即走 adoptPtySession 的退出清场路径)。 */
const exitCbs = new Map<string, () => void>();

function mkMeta(id: string): SessionMeta {
  return { id, profileId: "test-omp", cwd: "/proj", workspaceId: "w1", createdAt: 1, pid: 1, kind: "cli" };
}

function mkHost(initial: SessionMeta[] = []) {
  const events = new EventBus();
  const activated: unknown[] = [];
  events.on(KernelTopics.activeSessionChanged, (id) => activated.push(id));
  const store: { list: SessionMeta[] } = { list: [...initial] };
  const h: ReadoptHost = {
    findSession: (id) => store.list.find((s) => s.id === id),
    getSessions: () => store.list,
    setSessions: (sessions) => (store.list = sessions),
    appendOutput: vi.fn(),
    removeSession: vi.fn(async () => undefined),
    trackUnlisten: vi.fn(),
    notify: vi.fn(),
  };
  return { h, events, activated, store };
}

beforeEach(() => {
  vi.clearAllMocks();
  exitCbs.clear();
  ipcMocks.sessionList.mockResolvedValue([]);
  ipcMocks.onPtyOutput.mockImplementation(async () => () => undefined);
  ipcMocks.onPtyExit.mockImplementation(async (id: string, cb: () => void) => {
    exitCbs.set(id, cb);
    return () => undefined;
  });
});

describe("readoptSessions", () => {
  it("Rust 表合并入会话表并重建常驻订阅,不抢 tab", async () => {
    ipcMocks.sessionList.mockResolvedValue([mkMeta("a"), mkMeta("b")]);
    const { h, events, activated, store } = mkHost();
    await readoptSessions(h, events);
    expect(store.list.map((s) => s.id)).toEqual(["a", "b"]);
    expect(ipcMocks.onPtyOutput).toHaveBeenCalledTimes(2);
    expect(ipcMocks.onPtyExit).toHaveBeenCalledTimes(2);
    expect(activated).toEqual([]);
    expect(h.trackUnlisten).toHaveBeenCalledTimes(2);
  });

  it("已在表会话跳过,仅补缺失", async () => {
    ipcMocks.sessionList.mockResolvedValue([mkMeta("a"), mkMeta("b")]);
    const { h, events, store } = mkHost([mkMeta("a")]);
    await readoptSessions(h, events);
    expect(store.list.map((s) => s.id)).toEqual(["a", "b"]);
    const outs = ipcMocks.onPtyOutput.mock.calls.map((c) => c[0]);
    expect(outs).toEqual(["b"]);
  });

  it("Rust 空表零操作(app 冷启动)", async () => {
    const { h, events, store } = mkHost();
    await readoptSessions(h, events);
    expect(store.list).toEqual([]);
    expect(ipcMocks.onPtyOutput).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("并发双调收口单次(StrictMode 双 boot);完成后串行重入幂等", async () => {
    ipcMocks.sessionList.mockResolvedValue([mkMeta("a")]);
    const { h, events, store } = mkHost();
    await Promise.all([readoptSessions(h, events), readoptSessions(h, events)]);
    expect(ipcMocks.sessionList).toHaveBeenCalledTimes(1);
    expect(store.list.map((s) => s.id)).toEqual(["a"]);
    await readoptSessions(h, events);
    expect(ipcMocks.onPtyOutput).toHaveBeenCalledTimes(1);
  });

  it("重建的退出监听命中 removeSession 清场", async () => {
    ipcMocks.sessionList.mockResolvedValue([mkMeta("a")]);
    const { h, events } = mkHost();
    await readoptSessions(h, events);
    exitCbs.get("a")!();
    expect(h.removeSession).toHaveBeenCalledWith("a");
  });
});
