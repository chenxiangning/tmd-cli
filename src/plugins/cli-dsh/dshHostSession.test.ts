/**
 * DSH host 自拉起登记与停机契约(自 dshHost.test.ts 拆出,文件规模铁则):
 * 多槽会话登记(换端口再启动不漏上一代)、launch token 凭据链、按端口停本机监听。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentHostSessionId, startHostSession, stopHostSession } from "./dshHostSession";
import { DEFAULT_CONNECTION, loadConnection } from "./dshConnection";
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
  /* 等「本 id」的监听登记:只断言「被调用过」时,第二次 spawn 会在登记前就 fire
     token,捕获链白等到 20s 超时(多槽用例曾因此挂 5s 超时)。 */
  await vi.waitFor(() => expect(ipcMocks.onPtyOutput).toHaveBeenCalledWith(id, expect.any(Function)));
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
    expect(store.get("tmd.dsh.hostSessions.v2")).toBe('["pty-9"]');

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
    expect(store.get("tmd.dsh.hostSessions.v2")).toBe("[]");
  });

  it("换端口再启动不漏旧 host:stop 杀掉全部登记会话(单槽登记会留孤儿进程)", async () => {
    ipcMocks.sessionKill.mockResolvedValue(undefined);
    ipcMocks.procCommunicate.mockResolvedValue({ stdout: "", code: 0 });
    await spawnWithToken("pty-a");
    await spawnWithToken("pty-b");
    expect(currentHostSessionId()).toBe("pty-b");

    expect(await stopHostSession({ ...DEFAULT_CONNECTION, port: 3999 })).toBe("stopped");

    expect(ipcMocks.sessionKill.mock.calls.map((c) => c[0])).toEqual(["pty-a", "pty-b"]);
    expect(currentHostSessionId()).toBeNull();
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
    const mod = await import("./dshHostSession");
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

