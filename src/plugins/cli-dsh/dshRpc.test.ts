/**
 * DSH host-RPC 域逻辑契约:listHostSessions 的 cwd 过滤 + 启动竞态补扫
 * (侧栏扫描早于自动拉起的 host 就绪时,autoStart 开须等就绪补试一次)。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { listHostSessions } from "./dshRpc";
import type { DshConnection } from "./dshHost";

const ipcMocks = vi.hoisted(() => ({ quotaFetch: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMocks }));

const waitMocks = vi.hoisted(() => ({ waitForHostReady: vi.fn() }));
vi.mock("./dshHost", () => ({
  originOf: (conn: { host: string; port: number }) => `http://${conn.host}:${conn.port}`,
  waitForHostReady: waitMocks.waitForHostReady,
}));

afterEach(() => {
  ipcMocks.quotaFetch.mockReset();
  waitMocks.waitForHostReady.mockReset();
});

const CONN: DshConnection = { host: "127.0.0.1", port: 3080, customBin: "", autoStart: true };

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
  it("autoStart 开:host 未就绪失败后等就绪并补试一次,过滤照常生效", async () => {
    ipcMocks.quotaFetch
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(
        ok([
          ITEM("/ws"),
          ITEM("/other"),
          ITEM("/ws", { blank: true }),
          { cwd: "/ws", updatedAt: 1 },
        ]),
      );
    waitMocks.waitForHostReady.mockResolvedValue({ provider: "p" });

    const rows = await listHostSessions(CONN, "/ws");

    expect(waitMocks.waitForHostReady).toHaveBeenCalledTimes(1);
    expect(ipcMocks.quotaFetch).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([
      { id: "session-3", title: "t", modifiedAt: 1000, path: "http://127.0.0.1:3080/session-3" },
    ]);
  });

  it("autoStart 关:快速空,不等待不补试", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(fail);

    const rows = await listHostSessions({ ...CONN, autoStart: false }, "/ws");

    expect(rows).toEqual([]);
    expect(waitMocks.waitForHostReady).not.toHaveBeenCalled();
    expect(ipcMocks.quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("autoStart 开但 host 始终未就绪:补试不发生,返回空", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(fail);
    waitMocks.waitForHostReady.mockResolvedValue(null);

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows).toEqual([]);
    expect(ipcMocks.quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("首次即成功:不等待", async () => {
    ipcMocks.quotaFetch.mockResolvedValueOnce(ok([ITEM("/ws")]));
    waitMocks.waitForHostReady.mockResolvedValue({ provider: "p" });

    const rows = await listHostSessions(CONN, "/ws");

    expect(rows).toHaveLength(1);
    expect(waitMocks.waitForHostReady).not.toHaveBeenCalled();
  });
});
