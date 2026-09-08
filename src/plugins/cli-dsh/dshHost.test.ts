/**
 * DSH host 连接域逻辑契约:连接归一/持久化(含 customBin/autoStart 与
 * 旧档字段补默认)+ host.describe 线格式(codemoss host.rs 同款信封)。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONNECTION,
  describeRequestBody,
  dshCommand,
  ensureHostSession,
  isLocalHost,
  loadConnection,
  normalizeConnection,
  originOf,
  parseDescribeResponse,
  saveConnection,
  currentHostSessionId,
  startHostSession,
  stopHostSession,
  DSH_CONNECTION_KEY,
} from "./dshHost";

/* node 环境无 DOM:桩最小 localStorage,DSH_CONNECTION_KEY 也由它承载。 */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});
const ipcMocks = vi.hoisted(() => ({
  sessionSpawn: vi.fn(),
  sessionKill: vi.fn(),
  procCommunicate: vi.fn(),
  quotaFetch: vi.fn(),
  cliProbe: vi.fn(),
  configHomeDir: vi.fn(async () => "/home"),
}));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMocks }));
afterEach(() => {
  store.clear();
});

describe("normalizeConnection", () => {
  it("空 host / 非法端口回默认 127.0.0.1:3080,其余字段沿用 base", () => {
    expect(normalizeConnection("", "abc")).toEqual(DEFAULT_CONNECTION);
    expect(
      normalizeConnection("", "abc", {
        host: "0.0.0.0",
        port: 4000,
        customBin: "/opt/dsh",
        autoStart: false,
      }),
    ).toEqual({ host: "127.0.0.1", port: 3080, customBin: "/opt/dsh", autoStart: false });
  });

  it("端口截到 1-65535", () => {
    expect(normalizeConnection(" 0.0.0.0 ", "0").port).toBe(1);
    expect(normalizeConnection("0.0.0.0", "99999").port).toBe(65535);
    expect(normalizeConnection("0.0.0.0", "8080")).toEqual({
      host: "0.0.0.0",
      port: 8080,
      customBin: "",
      autoStart: true,
    });
  });
});

describe("loadConnection / saveConnection", () => {
  it("无存档回默认;坏 JSON 不抛", () => {
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
    localStorage.setItem(DSH_CONNECTION_KEY, "{broken");
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
  });

  it("存档 round-trip;旧档缺字段逐项补默认", () => {
    saveConnection({ host: "0.0.0.0", port: 4000, customBin: "/opt/dsh", autoStart: false });
    expect(loadConnection()).toEqual({
      host: "0.0.0.0",
      port: 4000,
      customBin: "/opt/dsh",
      autoStart: false,
    });
    localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify({ host: "", port: -3 }));
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
    localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify({ host: "0.0.0.0", port: 4000 }));
    expect(loadConnection()).toEqual({ ...DEFAULT_CONNECTION, host: "0.0.0.0", port: 4000 });
  });
});

describe("启动命令与 describe 线格式", () => {
  it("dshCommand:自定义路径优先,空串回退 PATH 的 dsh", () => {
    expect(dshCommand({ ...DEFAULT_CONNECTION, customBin: " /opt/dsh " })).toBe("/opt/dsh");
    expect(dshCommand(DEFAULT_CONNECTION)).toBe("dsh");
  });

  it("请求体:client-request + host.describe + 空 payload", () => {
    expect(describeRequestBody("rpc-1")).toBe(
      JSON.stringify({
        type: "client-request",
        rpcId: "rpc-1",
        method: "host.describe",
        payload: {},
      }),
    );
  });

  it("origin 拼接", () => {
    expect(originOf({ host: "127.0.0.1", port: 3080, customBin: "", autoStart: true })).toBe(
      "http://127.0.0.1:3080",
    );
  });
});

describe("parseDescribeResponse", () => {
  it("server-response ok → 只透传已知字段", () => {
    const body = {
      type: "server-response",
      rpcId: "tmd-1",
      result: { ok: true, value: { provider: "minimax-cn", model: "MiniMax-M3", sessions: 17 } },
    };
    expect(parseDescribeResponse(200, body)).toEqual({
      provider: "minimax-cn",
      model: "MiniMax-M3",
      sessions: 17,
    });
  });

  it("缺字段返回部分视图;value 非对象返回空视图", () => {
    expect(
      parseDescribeResponse(200, {
        type: "server-response",
        result: { ok: true, value: { provider: "deepseek" } },
      }),
    ).toEqual({ provider: "deepseek" });
    expect(
      parseDescribeResponse(200, { type: "server-response", result: { ok: true, value: "plain" } }),
    ).toEqual({});
  });

  it("ok:false / 信封错型 / 非 200 / 抛错输入 → null", () => {
    expect(
      parseDescribeResponse(200, {
        type: "server-response",
        result: { ok: false, error: { code: "x", message: "boom" } },
      }),
    ).toBeNull();
    expect(parseDescribeResponse(200, { type: "other" })).toBeNull();
    expect(
      parseDescribeResponse(502, { type: "server-response", result: { ok: true, value: {} } }),
    ).toBeNull();
    expect(parseDescribeResponse(200, null)).toBeNull();
  });
});
describe("isLocalHost(停机准入口径)", () => {
  it("本机回环地址放行,远程地址拒绝", () => {
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("::1")).toBe(true);
    expect(isLocalHost("0.0.0.0")).toBe(true);
    expect(isLocalHost("10.0.0.5")).toBe(false);
  });
});

/** 注入式 spawn 桩:startHostSession 不再裸调 ipc.sessionSpawn。 */
const spawnStub = (id: string) =>
  vi.fn(async (_profileId: string, _spec: unknown) => {
    ipcMocks.sessionSpawn();
    return { id };
  });
describe("自拉起登记与停机(codemoss stop_host 同款)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("start 登记 + 落盘;stop 杀会话并按端口 TERM 监听,登记清空", async () => {
    ipcMocks.sessionKill.mockResolvedValue(undefined);
    ipcMocks.procCommunicate.mockImplementation(async (spec: { command: string }) =>
      spec.command === "lsof" ? { stdout: "123\n456\n", code: 0 } : { stdout: "", code: 0 },
    );
    const conn = { ...DEFAULT_CONNECTION };
    const spawn = spawnStub("pty-9");
    await startHostSession(conn, spawn);
    expect(spawn).toHaveBeenCalledWith(
      "dsh",
      expect.objectContaining({ command: "dsh", args: ["web", "--host", "127.0.0.1", "--port", "3080", "--no-open"] }),
    );
    expect(currentHostSessionId()).toBe("pty-9");
    expect(store.get("tmd.dsh.hostSession.v1")).toBe("pty-9");

    expect(await stopHostSession(conn)).toBe("stopped");
    expect(ipcMocks.sessionKill).toHaveBeenCalledWith("pty-9");
    const lsof = ipcMocks.procCommunicate.mock.calls.find(
      (c) => (c[0] as { command: string }).command === "lsof",
    )![0] as { args: string[] };
    expect(lsof.args).toContain("-iTCP:3080");
    expect(lsof.args).toContain("-sTCP:LISTEN");
    const kill = ipcMocks.procCommunicate.mock.calls.find(
      (c) => (c[0] as { command: string }).command === "kill",
    )![0] as { args: string[] };
    expect(kill.args).toEqual(["-TERM", "123", "456"]);
    expect(currentHostSessionId()).toBeNull();
    expect(store.get("tmd.dsh.hostSession.v1")).toBeUndefined();
  });

  it("TERM 非零退出补 KILL", async () => {
    ipcMocks.sessionSpawn.mockResolvedValue({ id: "pty-1", pid: 1 });
    ipcMocks.procCommunicate.mockImplementation(async (spec: { command: string; args: string[] }) =>
      spec.command === "lsof"
        ? { stdout: "777\n", code: 0 }
        : spec.args[0] === "-TERM"
          ? { stdout: "", code: 1 }
          : { stdout: "", code: 0 },
    );
    const spawn = spawnStub("pty-1");
    await startHostSession({ ...DEFAULT_CONNECTION }, spawn);
    await stopHostSession({ ...DEFAULT_CONNECTION });
    const killArgs = ipcMocks.procCommunicate.mock.calls
      .filter((c) => (c[0] as { command: string }).command === "kill")
      .map((c) => (c[0] as { args: string[] }).args[0]);
    expect(killArgs).toEqual(["-TERM", "-KILL"]);
  });

  it("lsof 无监听:不调 kill,仍算 stopped", async () => {
    ipcMocks.procCommunicate.mockResolvedValue({ stdout: "", code: 0 });
    expect(await stopHostSession({ ...DEFAULT_CONNECTION })).toBe("stopped");
    expect(ipcMocks.procCommunicate.mock.calls.length).toBe(1);
  });

  it("远程 origin 拒绝停机:不杀任何进程", async () => {
    expect(
      await stopHostSession({ ...DEFAULT_CONNECTION, host: "10.0.0.5" }),
    ).toBe("remote");
    expect(ipcMocks.sessionKill).not.toHaveBeenCalled();
    expect(ipcMocks.procCommunicate).not.toHaveBeenCalled();
  });

  it("登记持久化:重载模块后仍读到(webview 重载不丢)", async () => {
    ipcMocks.sessionSpawn.mockResolvedValue({ id: "pty-7", pid: 7 });
    const spawn = spawnStub("pty-7");
    await startHostSession({ ...DEFAULT_CONNECTION }, spawn);
    vi.resetModules();
    const mod = await import("./dshHost");
    expect(mod.currentHostSessionId()).toBe("pty-7");
  });
});

describe("ensureHostSession(codemoss ensure_host 同款)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const OK = {
    status: 200,
    body: {
      type: "server-response",
      result: { ok: true, value: { provider: "minimax-cn", model: "MiniMax-M3", sessions: 2 } },
    },
  };

  it("host 已运行:直接复用,不重 spawn", async () => {
    ipcMocks.quotaFetch.mockResolvedValue(OK);
    const view = await ensureHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-x"));
    expect(view).toEqual({ provider: "minimax-cn", model: "MiniMax-M3", sessions: 2 });
    expect(ipcMocks.sessionSpawn).not.toHaveBeenCalled();
  });

  it("host 未运行:spawn 后等就绪(竞速窗口由 origin 探测兜住)", async () => {
    ipcMocks.quotaFetch
      .mockResolvedValueOnce({ status: 503, body: null })
      .mockResolvedValue(OK);
    ipcMocks.sessionSpawn.mockResolvedValue({ id: "pty-1", pid: 1 });
    vi.useFakeTimers();
    const pending = ensureHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-1"));
    await vi.advanceTimersByTimeAsync(1600);
    expect(await pending).toEqual({ provider: "minimax-cn", model: "MiniMax-M3", sessions: 2 });
    expect(ipcMocks.sessionSpawn).toHaveBeenCalledTimes(1);
  });
});
