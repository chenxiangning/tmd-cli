/**
 * DSH host-RPC 域逻辑契约:listHostSessions 的 cwd 过滤 + 启动竞态补扫
 * (侧栏扫描早于自动拉起的 host 就绪时,autoStart 开须等就绪补试一次);
 * blank 空壳不过滤(dsh Web UI 计数含空壳,隐藏会造成两边对不上);
 * deleteHostSession 扫 slug 目录定位会话盘目录删除(无 host 删除 RPC)。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { listHostSessions, deleteHostSession } from "./dshRpc";
import type { DshConnection } from "./dshConnection";

const ipcMocks = vi.hoisted(() => ({
  quotaFetch: vi.fn(),
  configHomeDir: vi.fn(),
  fsListDir: vi.fn(),
  fsRemovePath: vi.fn(),
}));

const waitMocks = vi.hoisted(() => ({ waitForHostReady: vi.fn(), hostStartInFlight: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMocks }));
vi.mock("./dshHost", () => ({
  originOf: (conn: { host: string; port: number }) => `http://${conn.host}:${conn.port}`,
  waitForHostReady: waitMocks.waitForHostReady,
  hostStartInFlight: waitMocks.hostStartInFlight,
  authHeaders: (conn: { cookie?: string }) => (conn.cookie ? { cookie: conn.cookie } : {}),
}));
/* rpc 经 authHeaders(mock)读 conn.cookie;此文件不测回读逻辑(在 dshHost.test)。 */
afterEach(() => {
  for (const m of Object.values(ipcMocks)) m.mockReset();
  waitMocks.waitForHostReady.mockReset();
  waitMocks.hostStartInFlight.mockReset();
});

const CONN: DshConnection = { host: "127.0.0.1", port: 3080, customBin: "", autoStart: true, cookie: "dsh-auth-x=v1.a" };

/** host-RPC 信封(200 + server-response ok)。 */
const ok = (items: unknown[]) => ({
  status: 200,
  body: { type: "server-response", result: { ok: true, value: { items } } },
});
const fail = { status: 502, body: null };

const ITEM = (cwd: string, extra: Record<string, unknown> = {}) => ({
  sessionId: `session-${cwd.length}`,
  cwd,
  updatedAt: 1000,
  projections: { values: { title: "t" } },
  ...extra,
});

describe("listHostSessions 启动竞态补扫", () => {
  it("有在途启动:host 未就绪失败后等就绪并补试一次,过滤照常生效", async () => {
    waitMocks.hostStartInFlight.mockReturnValue(true);
    ipcMocks.quotaFetch
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(
        ok([
          ITEM("/ws"),
          ITEM("/other"),
          ITEM("/ws", { blank: true, projections: {} }),
          { cwd: "/ws", updatedAt: 1 },
        ]),
      );
    waitMocks.waitForHostReady.mockResolvedValue({ provider: "p" });
    const rows = await listHostSessions(CONN, "/ws");

    expect(waitMocks.waitForHostReady).toHaveBeenCalledTimes(1);
    expect(ipcMocks.quotaFetch).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([
      { id: "session-3", title: "t", modifiedAt: 1000, path: "" },
      { id: "session-3", title: "空会话", modifiedAt: 1000, path: "" },
    ]);
  });

  it("blank 空壳不过滤:无标题的以「空会话」呈现,可被删除清理", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(
      ok([
        ITEM("/ws", { blank: true, projections: {} }),
        ITEM("/ws"),
      ]),
    );

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows.map((r) => r.title)).toEqual(["空会话", "t"]);
  });

  it("子代理会话不进侧栏:origin=subagent 或带 parentSessionId 的会话点开必崩", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(
      ok([
        ITEM("/ws", { origin: "subagent", parentSessionId: "session-parent" }),
        ITEM("/ws", { parentSessionId: "session-parent" }),
        ITEM("/ws", { origin: "subagent" }),
        ITEM("/ws"),
      ]),
    );

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows.map((r) => r.id)).toEqual(["session-3"]);
  });

  it("无在途启动:快速空,不等待不补试(host 被用户停掉后不白等 24s)", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(fail);

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows).toEqual([]);
    expect(waitMocks.waitForHostReady).not.toHaveBeenCalled();
    expect(ipcMocks.quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("有在途启动但 host 始终未就绪:补试不发生,返回空", async () => {
    waitMocks.hostStartInFlight.mockReturnValue(true);
    ipcMocks.quotaFetch.mockResolvedValueOnce(fail);
    waitMocks.waitForHostReady.mockResolvedValue(null);

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows).toEqual([]);
    expect(ipcMocks.quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("首次即成功:不等待;线格式 = session/list + {_request} + cookie 头", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(ok([ITEM("/ws")]));
    waitMocks.waitForHostReady.mockResolvedValue({ provider: "p" });

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows).toHaveLength(1);
    expect(waitMocks.waitForHostReady).not.toHaveBeenCalled();
    const call = ipcMocks.quotaFetch.mock.calls[0][0] as {
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(call.url).toBe("http://127.0.0.1:3080/api/session/list");
    expect(call.headers.cookie).toBe("dsh-auth-x=v1.a");
    expect(JSON.parse(call.body).payload).toEqual({ args: { _request: {} } });
  });
});

describe("deleteHostSession 会话盘删除", () => {
  it("扫 slug 目录定位会话目录(目录名 === 会话 id),命中即 fsRemovePath", async () => {
    ipcMocks.quotaFetch.mockResolvedValue(ok([])); /* 不在册 = 非活会话,放行 */
    ipcMocks.configHomeDir.mockResolvedValue("/home/u");
    ipcMocks.fsListDir.mockImplementation(async (p: string) =>
      p.endsWith("/sessions")
        ? [{ name: "--a--", path: "/home/u/.dsh/sessions/--a--", isDir: true }, { name: "x.json", path: "/home/u/.dsh/sessions/x.json", isDir: false }]
        : p.endsWith("--a--")
          ? [{ name: "session-abc", path: "/home/u/.dsh/sessions/--a--/session-abc", isDir: true }]
          : p.endsWith("session-abc")
            ? [{ name: "session.v4.jsonl.zstd", path: "/home/u/.dsh/sessions/--a--/session-abc/session.v4.jsonl.zstd", isDir: false }]
            : [],
    );
    ipcMocks.fsRemovePath.mockResolvedValue(undefined);

    await deleteHostSession(CONN, "session-abc");

    expect(ipcMocks.fsRemovePath).toHaveBeenCalledTimes(1);
    expect(ipcMocks.fsRemovePath).toHaveBeenCalledWith("/home/u/.dsh/sessions/--a--/session-abc");
  });

  it("活会话(host 报 attached/running)拒绝删盘:抛错让调用方保留磁盘数据", async () => {
    ipcMocks.quotaFetch.mockResolvedValue(
      ok([ITEM("/ws", { sessionId: "live-1", running: true })]),
    );
    await expect(deleteHostSession(CONN, "live-1")).rejects.toThrow(/拒绝删盘/);
    expect(ipcMocks.fsRemovePath).not.toHaveBeenCalled();
  });

  it("目录里没有会话盘文件:不删(防误删同名目录)", async () => {
    ipcMocks.quotaFetch.mockResolvedValue(ok([]));
    ipcMocks.configHomeDir.mockResolvedValue("/home/u");
    ipcMocks.fsListDir.mockImplementation(async (p: string) =>
      p.endsWith("/sessions")
        ? [{ name: "--a--", path: "/home/u/.dsh/sessions/--a--", isDir: true }]
        : p.endsWith("--a--")
          ? [{ name: "not-a-session", path: "/home/u/.dsh/sessions/--a--/not-a-session", isDir: true }]
          : [],
    );
    await deleteHostSession(CONN, "not-a-session");
    expect(ipcMocks.fsRemovePath).not.toHaveBeenCalled();
  });

  it("目录名带 session- 前缀的 id(id 本体含前缀):照样删掉", async () => {
    ipcMocks.quotaFetch.mockResolvedValue(ok([]));
    ipcMocks.configHomeDir.mockResolvedValue("/home/u");
    ipcMocks.fsListDir.mockImplementation(async (p: string) =>
      p.endsWith("/sessions")
        ? [{ name: "--a--", path: "/home/u/.dsh/sessions/--a--", isDir: true }]
        : p.endsWith("--a--")
          ? [{ name: "session-abc", path: "/home/u/.dsh/sessions/--a--/session-abc", isDir: true }]
          : p.endsWith("session-abc")
            ? [{ name: "session.v4.jsonl.zstd", path: "/home/u/.dsh/sessions/--a--/session-abc/session.v4.jsonl.zstd", isDir: false }]
            : [],
    );
    ipcMocks.fsRemovePath.mockResolvedValue(undefined);

    await deleteHostSession(CONN, "abc");

    expect(ipcMocks.fsRemovePath).toHaveBeenCalledWith("/home/u/.dsh/sessions/--a--/session-abc");
  });

  it("各 slug 目录都没有:幂等成功,不删任何路径", async () => {
    ipcMocks.configHomeDir.mockResolvedValue("/home/u");
    ipcMocks.fsListDir.mockResolvedValue([{ name: "--a--", path: "/home/u/.dsh/sessions/--a--", isDir: true }]);
    ipcMocks.fsRemovePath.mockResolvedValue(undefined);

    await deleteHostSession(CONN, "session-missing");

    expect(ipcMocks.fsRemovePath).not.toHaveBeenCalled();
  });

  it("configHomeDir 失败:静默返回(不猜 home)", async () => {
    ipcMocks.configHomeDir.mockRejectedValue(new Error("no tauri"));

    await deleteHostSession(CONN, "session-x");

    expect(ipcMocks.fsListDir).not.toHaveBeenCalled();
    expect(ipcMocks.fsRemovePath).not.toHaveBeenCalled();
  });
});

