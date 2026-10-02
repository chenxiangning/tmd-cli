/**
 * dsh-session 会话装配契约:工作区注册 + 采用既有会话,按拒绝原因分流 ——
 * writer-held → 读者模式只读打开原会话(不新建);其余 → 回落新建。
 * 防「子代理子会话/被占用会话被点开 → 适配器硬崩或悄悄换成空白新会话」回归
 * (host 拒绝语义见 dsh-api-session-controller: session/agent-busy、
 * session/writer-held)。
 */

import { describe, expect, it, vi } from "vitest";
import { createSession, openWorkspace } from "./dsh-session.cjs";

type Envelope = { ok: boolean; value?: unknown; error?: unknown };
const rpcOf = (...envelopes: Envelope[]) => {
  const fn = vi.fn();
  for (const e of envelopes) fn.mockResolvedValueOnce(e);
  return fn as unknown as (origin: string, method: string, args: unknown) => Promise<Envelope>;
};
const wsValue = (id: string) => ({ ok: true, value: { workspace: { workspaceId: id } } });
const sessValue = (id: string) => ({ ok: true, value: { sessionId: id } });
const busy = {
  ok: false,
  error: { code: "session/agent-busy", message: 'session "s1" is owned by subagent routing' },
};
const writerHeld = {
  ok: false,
  error: {
    code: "session/writer-held",
    message: 'session "s1" is already owned by an active write handle',
  },
};

describe("openWorkspace", () => {
  it("注册成功取 workspaceId", async () => {
    const rpc = rpcOf(wsValue("ws-1"));
    await expect(openWorkspace("http://h:1", "/ws", rpc)).resolves.toEqual({ ok: true, workspaceId: "ws-1" });
    expect(rpc).toHaveBeenCalledWith("http://h:1", "workspace/create", { request: { path: "/ws" } });
  });

  it("host 未返回 workspaceId = 失败(不猜)", async () => {
    const rpc = rpcOf({ ok: true, value: {} });
    await expect(openWorkspace("http://h:1", "/ws", rpc)).resolves.toEqual({
      ok: false, error: "host 未返回 workspaceId",
    });
  });
});

describe("createSession", () => {
  it("无 sessionId:直接新建(写者)", async () => {
    const rpc = rpcOf(sessValue("new-1"));
    await expect(createSession("http://h:1", "ws-1", undefined, rpc)).resolves.toEqual({
      ok: true, sessionId: "new-1", mode: "owner", adoptError: null, notice: null,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("有 sessionId 且采用成功:不新建,写者模式", async () => {
    const rpc = rpcOf(sessValue("s1"));
    await expect(createSession("http://h:1", "ws-1", "s1", rpc)).resolves.toEqual({
      ok: true, sessionId: "s1", mode: "owner", adoptError: null, notice: null,
    });
    expect(rpc).toHaveBeenCalledWith("http://h:1", "session/create", {
      request: { workspaceId: "ws-1", sessionId: "s1" },
    });
  });

  it("writer-held 先重试:并发开窗收尾后幂等采用成功(写者模式)", async () => {
    const rpc = rpcOf(writerHeld, writerHeld, sessValue("s1"));
    const pause = vi.fn().mockResolvedValue(undefined);
    const out = await createSession("http://h:1", "ws-1", "s1", rpc, pause);
    expect(out).toEqual({ ok: true, sessionId: "s1", mode: "owner", adoptError: null, notice: null });
    expect(rpc).toHaveBeenCalledTimes(3); /* 首次 + 两次重试 */
    expect(pause).toHaveBeenCalledWith(1500);
  });

  it("writer-held 重试耗尽(客户端长期占用):读者模式打开原会话,不新建", async () => {
    const rpc = vi.fn().mockResolvedValue(writerHeld);
    const out = await createSession("http://h:1", "ws-1", "s1", rpc, () => Promise.resolve());
    expect(out).toEqual({
      ok: true,
      sessionId: "s1", /* 用请求的 id 走只读 follow,而不是新 id */
      mode: "reader",
      adoptError: null,
      notice: 'session "s1" is already owned by an active write handle',
    });
    expect(rpc).toHaveBeenCalledTimes(4); /* 首次 + 3 次重试,期间不新建 */
  });

  it("子代理子会话(session/agent-busy):回落新建并带回原因", async () => {
    const rpc = rpcOf(busy, sessValue("new-2"));
    const out = await createSession("http://h:1", "ws-1", "s1", rpc);
    expect(out).toEqual({
      ok: true, sessionId: "new-2", mode: "owner",
      adoptError: 'session "s1" is owned by subagent routing', notice: null,
    });
    expect(rpc).toHaveBeenLastCalledWith("http://h:1", "session/create", {
      request: { workspaceId: "ws-1" },
    });
  });

  it("回落新建也失败:整体失败,报新建那次的原因", async () => {
    const rpc = rpcOf(busy, { ok: false, error: "workspace gone" });
    const out = await createSession("http://h:1", "ws-1", "s1", rpc);
    expect(out).toEqual({ ok: false, error: "workspace gone" });
  });

  it("无 sessionId 却拿不到 id:失败(不重试)", async () => {
    const rpc = rpcOf({ ok: true, value: {} });
    await expect(createSession("http://h:1", "ws-1", undefined, rpc)).resolves.toEqual({
      ok: false, error: "host 未返回 sessionId",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
