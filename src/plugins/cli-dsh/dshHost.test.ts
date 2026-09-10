/**
 * DSH host 进程域契约:settings/describe 探针线格式(0.1.2 typert 信封)、
 * launch token 凭据链(PTY 抓 token 换 cookie 落盘)、自拉起登记与停机
 * (codemoss stop_host 同款)、ensure adopt/换代语义。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureHostSession,
  parseDescribeResponse,
  currentHostSessionId,
  startHostSession,
  stopHostSession,
} from "./dshHost";
import { DEFAULT_CONNECTION, loadConnection, saveConnection } from "./dshConnection";
import type { DshConnection } from "./dshConnection";

/* node 环境无 DOM:桩最小 localStorage。 */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});
const ipcMocks = vi.hoisted(() => {
  const ptyCbs = new Map<string, (text: string) => void>();
  return {
    sessionSpawn: vi.fn(),
    sessionKill: vi.fn(),
    procCommunicate: vi.fn(),
    quotaFetch: vi.fn(),
    cliProbe: vi.fn(),
    configHomeDir: vi.fn(async () => "/home"),
    onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
      ptyCbs.set(id, cb);
      return () => ptyCbs.delete(id);
    }),
    firePty: (id: string, text: string) => ptyCbs.get(id)?.(text),
  };
});
vi.mock("@kernel/ipc", () => ({ ipc: ipcMocks, onPtyOutput: ipcMocks.onPtyOutput }));
afterEach(() => {
  store.clear();
});

describe("parseDescribeResponse(settings/describe 信封)", () => {
  const envelope = (value: unknown) => ({
    type: "server-response",
    rpcId: "tmd-1",
    result: { ok: true, value },
  });

  it("namespaces[agent-default-model] → provider/model", () => {
    expect(
      parseDescribeResponse(
        200,
        envelope({
          writable: true,
          namespaces: [
            { ns: "other", value: { provider: "x" } },
            { ns: "agent-default-model", value: { provider: "minimax-cn", model: "MiniMax-M3" } },
          ],
        }),
      ),
    ).toEqual({ provider: "minimax-cn", model: "MiniMax-M3" });
  });

  it("缺 namespaces / 缺目标 ns / 字段缺失 → 空视图(200+ok 即存活)", () => {
    expect(parseDescribeResponse(200, envelope({ writable: true }))).toEqual({});
    expect(parseDescribeResponse(200, envelope({ namespaces: [{ ns: "other" }] }))).toEqual({});
    expect(
      parseDescribeResponse(
        200,
        envelope({ namespaces: [{ ns: "agent-default-model", value: { provider: "p" } }] }),
      ),
    ).toEqual({ provider: "p" });
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


/** 注入式 spawn 桩:startHostSession 不再裸调 ipc.sessionSpawn。 */
const spawnStub = (id: string) =>
  vi.fn(async (_profileId: string, _spec: unknown) => {
    ipcMocks.sessionSpawn();
    return { id };
  });

/** startHostSession 会等 token 抓取(20s 封顶):spawn 后 fire 一次性 token + 303 交换让它快跑完。 */
async function spawnWithToken(id: string, token = "ts_x") {
  ipcMocks.quotaFetch.mockResolvedValue({
    status: 303,
    body: "",
    headers: { "set-cookie": ["dsh-auth-x=v1.abc; Path=/"] },
  });
  const spawn = spawnStub(id);
  const pending = startHostSession({ ...DEFAULT_CONNECTION }, spawn);
  await vi.waitFor(() => expect(ipcMocks.onPtyOutput).toHaveBeenCalled());
  ipcMocks.firePty(id, `dsh web: http://127.0.0.1:3080/?token=${token}\n`);
  await pending;
  return spawn;
}

describe("自拉起登记与停机(codemoss stop_host 同款)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("start 登记 + 落盘;stop 杀会话并按端口 TERM 监听,登记清空", async () => {
    ipcMocks.sessionKill.mockResolvedValue(undefined);
    ipcMocks.procCommunicate.mockImplementation(async (spec: { command: string }) =>
      spec.command === "lsof" ? { stdout: "123\n456\n", code: 0 } : { stdout: "", code: 0 },
    );
    const conn: DshConnection = { ...DEFAULT_CONNECTION };
    const spawn = await spawnWithToken("pty-9");
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
    await spawnWithToken("pty-1");
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
    expect(await stopHostSession({ ...DEFAULT_CONNECTION, host: "10.0.0.5" })).toBe("remote");
    expect(ipcMocks.sessionKill).not.toHaveBeenCalled();
    expect(ipcMocks.procCommunicate).not.toHaveBeenCalled();
  });

  it("登记持久化:重载模块后仍读到(webview 重载不丢;动态 import 是本用例的受测边界)", async () => {
    ipcMocks.sessionSpawn.mockResolvedValue({ id: "pty-7", pid: 7 });
    await spawnWithToken("pty-7");
    vi.resetModules();
    const mod = await import("./dshHost");
    expect(mod.currentHostSessionId()).toBe("pty-7");
  });

  it("PTY 输出抓 token → 换 cookie 落盘(凭据链)", async () => {
    ipcMocks.quotaFetch.mockResolvedValue({
      status: 303,
      body: "",
      headers: { "set-cookie": ["dsh-auth-x=v1.abc; Max-Age=2592000; Path=/; HttpOnly"] },
    });
    const pending = startHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-t"));
    await vi.waitFor(() => expect(ipcMocks.onPtyOutput).toHaveBeenCalled());
    ipcMocks.firePty("pty-t", "dsh web: http://127.0.0.1:3080/?token=ts_tok123 (LAN: http://10.0.0.5:3080/?token=ts_tok123)\n");
    await pending;
    await vi.waitFor(() => {
      expect(loadConnection().cookie).toBe("dsh-auth-x=v1.abc");
      expect(loadConnection().launchToken).toBe("ts_tok123");
    });
    const call = ipcMocks.quotaFetch.mock.calls[0][0] as {
      url: string;
      noRedirect?: boolean;
      includeHeaders?: boolean;
      text?: boolean;
    };
    expect(call.url).toBe("http://127.0.0.1:3080/?token=ts_tok123");
    expect(call.noRedirect).toBe(true);
    expect(call.includeHeaders).toBe(true);
    expect(call.text).toBe(true); /* 303 body 非 JSON,缺了会被 quota_fetch 解析抛错 */
  });
});


describe("ensureHostSession(codemoss ensure_host 同款)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /** settings/describe 探针的 200 信封(namespaces 形态)。 */
  const OK = {
    status: 200,
    body: {
      type: "server-response",
      result: {
        ok: true,
        value: {
          writable: true,
          namespaces: [
            { ns: "agent-default-model", value: { provider: "minimax-cn", model: "MiniMax-M3" } },
          ],
        },
      },
    },
  };

  it("host 已运行:直接复用,不重 spawn", async () => {
    ipcMocks.quotaFetch.mockResolvedValue(OK);
    const view = await ensureHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-x"));
    expect(view).toEqual({ provider: "minimax-cn", model: "MiniMax-M3" });
    expect(ipcMocks.sessionSpawn).not.toHaveBeenCalled();
  });

  it("探针带 BrowserAuth cookie 头", async () => {
    saveConnection({ ...DEFAULT_CONNECTION, cookie: "dsh-auth-x=v1.a" });
    ipcMocks.quotaFetch.mockResolvedValue(OK);
    await ensureHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-x"));
    const call = ipcMocks.quotaFetch.mock.calls[0][0] as { headers: Record<string, string>; url: string };
    expect(call.url).toBe("http://127.0.0.1:3080/api/settings/describe");
    expect(call.headers.cookie).toBe("dsh-auth-x=v1.a");
  });

  it("host 未运行:spawn 后等就绪(竞速窗口由 origin 探测兜住)", async () => {
    ipcMocks.quotaFetch
      .mockResolvedValueOnce({ status: 503, body: null })
      .mockResolvedValue(OK);
    ipcMocks.sessionSpawn.mockResolvedValue({ id: "pty-1", pid: 1 });
    vi.useFakeTimers();
    const pending = ensureHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-1"));
    await vi.advanceTimersByTimeAsync(26_000);
    expect(await pending).toEqual({ provider: "minimax-cn", model: "MiniMax-M3" });
    expect(ipcMocks.sessionSpawn).toHaveBeenCalledTimes(1);
  });

  it("host 活着但 401 且远程:不 spawn,直接收口未运行", async () => {
    ipcMocks.quotaFetch.mockResolvedValue({ status: 401, body: "unauthorized" });
    const view = await ensureHostSession({ ...DEFAULT_CONNECTION, host: "10.0.0.5" }, spawnStub("pty-x"));
    expect(view).toBeNull();
    expect(ipcMocks.sessionSpawn).not.toHaveBeenCalled();
  });

  it("host 活着但 401 且本机:停监听换代自启,抓 token 换 cookie 后就绪", async () => {
    /* 探针按凭据分流:无 cookie → 401,带上换代换来的 cookie → OK。
       若 ensure 拿 spawn 前的旧 conn 探测(无 cookie),这里必收口 null。 */
    ipcMocks.quotaFetch.mockImplementation(async (spec: { url: string; headers?: Record<string, string> }) => {
      if (!spec.url.includes("/api/settings/describe")) {
        return { status: 303, body: "", headers: { "set-cookie": ["dsh-auth-x=v1.a; Path=/"] } };
      }
      return spec.headers?.cookie === "dsh-auth-x=v1.a" ? OK : { status: 401, body: "unauthorized" };
    });
    ipcMocks.sessionKill.mockResolvedValue(undefined);
    ipcMocks.procCommunicate.mockResolvedValue({ stdout: "", code: 0 });
    ipcMocks.sessionSpawn.mockResolvedValue({ id: "pty-2", pid: 2 });
    const pending = ensureHostSession({ ...DEFAULT_CONNECTION }, spawnStub("pty-2"));
    await vi.waitFor(() => expect(ipcMocks.onPtyOutput).toHaveBeenCalled());
    ipcMocks.firePty("pty-2", "dsh web: http://127.0.0.1:3080/?token=ts_9\n");
    expect(await pending).toEqual({ provider: "minimax-cn", model: "MiniMax-M3" });
    expect(ipcMocks.sessionSpawn).toHaveBeenCalledTimes(1);
    /* 换代前先停掉无凭据的遗留监听 */
    const lsof = ipcMocks.procCommunicate.mock.calls.find(
      (c) => (c[0] as { command: string }).command === "lsof",
    );
    expect(lsof).toBeDefined();
  });
});
