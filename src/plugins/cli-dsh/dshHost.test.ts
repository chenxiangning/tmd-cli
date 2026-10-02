/**
 * DSH host 探针与装配契约:settings/describe 线格式(0.1.2 typert 信封,含 401/403
 * 纯文本体必须声明 text)、ensure adopt/换代语义(自拉起登记与停机见
 * dshHostSession.test.ts)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureHostSession, parseDescribeResponse, probeHost } from "./dshHost";
import { DEFAULT_CONNECTION, saveConnection } from "./dshConnection";

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

describe("probeHost 的 text 声明(401/403 是纯文本体)", () => {
  it("探针声明 text:true:不声明会被 Rust 侧 JSON 解析拒掉,401 判据整条链不可达", async () => {
    ipcMocks.quotaFetch.mockResolvedValue({ status: 200, body: "{}" });
    await probeHost({ ...DEFAULT_CONNECTION });
    const spec = ipcMocks.quotaFetch.mock.calls[0][0] as { text?: boolean };
    expect(spec.text).toBe(true);
  });

  it("401 → unauthorized;403 → forbidden;二者都不当作「没起来」", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce({ status: 401, body: "unauthorized" });
    await expect(probeHost({ ...DEFAULT_CONNECTION })).resolves.toEqual({
      view: null, unauthorized: true, forbidden: false,
    });
    ipcMocks.quotaFetch.mockResolvedValueOnce({ status: 403, body: "forbidden" });
    await expect(probeHost({ ...DEFAULT_CONNECTION })).resolves.toEqual({
      view: null, unauthorized: false, forbidden: true,
    });
  });

  it("200 + 字符串体(声明 text 后的真实回包)照常解出视图", async () => {
    ipcMocks.quotaFetch.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        type: "server-response",
        result: { ok: true, value: { namespaces: [{ ns: "agent-default-model", value: { provider: "p", model: "m" } }] } },
      }),
    });
    await expect(probeHost({ ...DEFAULT_CONNECTION })).resolves.toEqual({
      view: { provider: "p", model: "m" }, unauthorized: false, forbidden: false,
    });
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
