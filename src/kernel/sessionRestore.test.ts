/**
 * 重启现场恢复契约测试(kernel/sessionRestore.ts)。
 * 覆盖:recordSessionKey 去重保序/帽截断/首位幂等 / 三段 key 反解析 /
 * 失败矩阵纯函数五路径 + resume / 45s 错峰编排串行回位与 evict 回写 / 跳过中止。
 * host 与 workspace 注入替身(vi.mock),不触真实单例;isSessionDeleted 走真实
 * settings(tombstone 由 updateSettings 铺设)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMock = vi.hoisted(() => ({
  readoptSessions: vi.fn(async () => undefined),
  openDiskSession: vi.fn(async () => ({ id: "pty-x" })),
  getCliProfile: vi.fn<(id: string) => unknown>((id) =>
    id === "claude" ? { id, listSessions: async () => [{ id: "c1", modifiedAt: 1 }] } : undefined,
  ),
}));

vi.mock("./host", () => ({ host: hostMock }));
vi.mock("./workspace", () => ({
  workspacesReady: Promise.resolve(),
  getWorkspaces: () => [
    { id: "ws1", name: "r1", root: "/r1", createdAt: 0 },
    { id: "wsR", name: "r-remote", root: "\\\\wsl.localhost\\Ubuntu\\repo", createdAt: 0 },
  ],
}));

import {
  getSessionRestoreKeys,
  parseSessionRestoreKey,
  recordSessionKey,
  resetSessionRestoreForTest,
  resolveSessionRestoreStep,
  scheduleSessionRestore,
  setSessionRestoreEnabled,
  skipSessionRestore,
  getSessionRestoreProgress,
  type SessionRestoreDeps,
} from "./sessionRestore";
import { getSettingsState, updateSettings } from "./settings";
import { registerWorkspaceOrigin } from "./workspaceOrigins";
import type { Workspace } from "./workspace";

const ws = (id: string, root: string): Workspace => ({ id, name: id, root, createdAt: 0 });

const deps = (over: Partial<SessionRestoreDeps>): SessionRestoreDeps => ({
  workspaces: new Map([["ws1", ws("ws1", "/r1")], ["ws2", ws("ws2", "/r2")]]),
  hasProfile: (id) => id === "claude",
  isDeleted: () => false,
  diskIds: undefined,
  ...over,
});

beforeEach(() => {
  resetSessionRestoreForTest();
  updateSettings({ sessionRestore: { enabled: true, keys: [] }, sessionDeleted: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordSessionKey", () => {
  it("unshift 去重保序,帽随 sessionTabsMax 尾部截断", () => {
    updateSettings({ sessionTabsMax: 3 });
    recordSessionKey("k1");
    recordSessionKey("k2");
    recordSessionKey("k3");
    recordSessionKey("k4"); // 超帽:k1 从尾部丢弃
    expect(getSessionRestoreKeys()).toEqual(["k4", "k3", "k2"]);
    recordSessionKey("k2"); // 旧 key 重新打开 → 置顶
    expect(getSessionRestoreKeys()).toEqual(["k2", "k4", "k3"]);
  });

  it("最新已在首位时幂等(keys 不变)", () => {
    updateSettings({ sessionRestore: { enabled: true, keys: ["k1", "k2"] } });
    recordSessionKey("k1");
    expect(getSessionRestoreKeys()).toEqual(["k1", "k2"]);
  });

  it("setSessionRestoreEnabled 只动总闸不动 keys", () => {
    updateSettings({ sessionRestore: { enabled: true, keys: ["k1"] } });
    setSessionRestoreEnabled(false);
    expect(getSettingsState().settings.sessionRestore).toEqual({ enabled: false, keys: ["k1"] });
  });
});

describe("parseSessionRestoreKey", () => {
  it("前两段定界,余段全归 cliSessionId;缺段/空段 = null", () => {
    expect(parseSessionRestoreKey("ws1:claude:c-9")).toEqual({ wsId: "ws1", profileId: "claude", cliSessionId: "c-9" });
    expect(parseSessionRestoreKey("ws1:claude:a:b:c")).toEqual({ wsId: "ws1", profileId: "claude", cliSessionId: "a:b:c" });
    expect(parseSessionRestoreKey("nocolon")).toBeNull();
    expect(parseSessionRestoreKey("ws1:")).toBeNull();
    expect(parseSessionRestoreKey(":p:c")).toBeNull();
  });
});

describe("settings sanitize 链(updateSettings 全链)", () => {
  it("合法补丁生效;非对象整体回落默认(开 + 空 keys)", () => {
    updateSettings({ sessionRestore: { enabled: false, keys: ["a:b:c"] } });
    expect(getSettingsState().settings.sessionRestore).toEqual({ enabled: false, keys: ["a:b:c"] });
    updateSettings({ sessionRestore: "bad" as never });
    expect(getSettingsState().settings.sessionRestore).toEqual({ enabled: true, keys: [] });
    updateSettings({ sessionRestore: { enabled: "yes" as never, keys: "no" as never } });
    expect(getSettingsState().settings.sessionRestore).toEqual({ enabled: true, keys: [] });
  });
  it("keys 去重保序,非串丢弃,超帽从尾部丢(首 = 最新)", () => {
    updateSettings({ sessionTabsMax: 3 });
    updateSettings({ sessionRestore: { enabled: true, keys: ["w:p:c", "w:p:c", "", 7, "w2:p2:c2"] as never } });
    expect(getSettingsState().settings.sessionRestore.keys).toEqual(["w:p:c", "w2:p2:c2"]);
    updateSettings({ sessionRestore: { enabled: true, keys: ["k1", "k2", "k3", "k4"] } });
    expect(getSettingsState().settings.sessionRestore.keys).toEqual(["k1", "k2", "k3"]);
  });
});

describe("失败矩阵(resolveSessionRestoreStep)", () => {
  it("畸形 key → evict:malformed", () => {
    expect(resolveSessionRestoreStep("bad", deps({}))).toEqual({ key: "bad", action: "evict", reason: "malformed" });
  });
  it("工作区已删 → evict:workspace", () => {
    expect(resolveSessionRestoreStep("gone:claude:c1", deps({})).action).toBe("evict");
  });
  it("引擎缺失 → keep:profile", () => {
    expect(resolveSessionRestoreStep("ws1:ghost:c1", deps({}))).toEqual({ key: "ws1:ghost:c1", action: "keep", reason: "profile" });
  });
  it("用户已删(tombstone)→ evict:deleted", () => {
    const step = resolveSessionRestoreStep("ws1:claude:c9", deps({ isDeleted: (k) => k === "ws1:claude:c9" }));
    expect(step).toEqual({ key: "ws1:claude:c9", action: "evict", reason: "deleted" });
  });
  it("磁盘已无(清扫删盘)→ evict:missing", () => {
    const step = resolveSessionRestoreStep("ws1:claude:c2", deps({ diskIds: new Set(["c1"]) }));
    expect(step).toEqual({ key: "ws1:claude:c2", action: "evict", reason: "missing" });
  });
  it("列举失败/无列举面(无法预判)→ keep:missing", () => {
    expect(resolveSessionRestoreStep("ws1:claude:c1", deps({ diskIds: null }))).toEqual({ key: "ws1:claude:c1", action: "keep", reason: "missing" });
  });
  it("全通过 → resume 且带 root", () => {
    expect(resolveSessionRestoreStep("ws1:claude:c1", deps({ diskIds: new Set(["c1"]) }))).toEqual({
      key: "ws1:claude:c1", action: "resume", wsId: "ws1", profileId: "claude", cliSessionId: "c1", root: "/r1",
    });
  });
});

describe("编排(scheduleSessionRestore)", () => {
  it("45s 错峰后串行回位:命中 resume、tombstone/失Workspace evict 回写,失败静默保留", async () => {
    updateSettings({
      sessionRestore: {
        enabled: true,
        keys: ["ws1:claude:c1", "ws1:claude:c9", "gone:claude:c2"],
      },
      sessionDeleted: { "ws1:claude:c9": { deletedAt: 1 } },
    });
    vi.useFakeTimers();
    scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(hostMock.openDiskSession).toHaveBeenCalledTimes(1);
    expect(hostMock.openDiskSession).toHaveBeenCalledWith("claude", "/r1", "ws1", "c1");
    expect(getSessionRestoreKeys()).toEqual(["ws1:claude:c1"]); // tombstone/失工作区已逐出
    expect(getSessionRestoreProgress().active).toBe(false);
  });

  it("spawn 失败 → 保留 key 下次再试", async () => {
    updateSettings({ sessionRestore: { enabled: true, keys: ["ws1:claude:c1"] } });
    hostMock.openDiskSession.mockRejectedValueOnce(new Error("spawn fail"));
    vi.useFakeTimers();
    scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(getSessionRestoreKeys()).toEqual(["ws1:claude:c1"]);
    expect(getSessionRestoreProgress().active).toBe(false);
  });

  it("远程工作区跳过本机扫盘预判:健康 key 走 resume 而非 evict:missing", async () => {
    /* wsl 式来源认领 wsR:本机 listSessions 扫远端 root 必空,预判若跑会误 evict */
    const offOrigin = registerWorkspaceOrigin({
      id: "wsl-test",
      label: "远程(测试)",
      matches: (ws) => ws.id === "wsR",
      remoteExec: () => ({}) as never,
      openRemoteDiskSession: () => false, /* 接管面为假 → 落 openDiskSession 断言可达 */
    });
    try {
      updateSettings({ sessionRestore: { enabled: true, keys: ["wsR:claude:c1"] } });
      vi.useFakeTimers();
      scheduleSessionRestore();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(hostMock.openDiskSession).toHaveBeenCalledWith("claude", "\\\\wsl.localhost\\Ubuntu\\repo", "wsR", "c1");
      expect(getSessionRestoreKeys()).toEqual(["wsR:claude:c1"]); // 未被误 evict
    } finally {
      offOrigin();
    }
  });

  it("总闸关闭 / 空 keys 不跑;跳过中止剩余且保留", async () => {
    updateSettings({ sessionRestore: { enabled: false, keys: ["ws1:claude:c1"] } });
    vi.useFakeTimers();
    scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(hostMock.readoptSessions).not.toHaveBeenCalled();

    resetSessionRestoreForTest();
    updateSettings({ sessionRestore: { enabled: true, keys: [] } });
    scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(hostMock.readoptSessions).not.toHaveBeenCalled();

    resetSessionRestoreForTest();
    const gate = Promise.withResolvers<{ id: string }>();
    hostMock.openDiskSession.mockImplementationOnce(() => gate.promise);
    updateSettings({ sessionRestore: { enabled: true, keys: ["ws1:claude:c1", "ws1:claude:c2"] } });
    scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(getSessionRestoreProgress()).toEqual({ active: true, done: 0, total: 2 });
    skipSessionRestore();
    gate.resolve({ id: "pty-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hostMock.openDiskSession).toHaveBeenCalledTimes(1); // c2 未跑
    expect(getSessionRestoreKeys()).toEqual(["ws1:claude:c1", "ws1:claude:c2"]); // 跳过全保留
    expect(getSessionRestoreProgress().active).toBe(false);
  });
});
