/**
 * lspClient 协议层测试 —— mock transport 后驱动消息路由:
 * initialize 握手 / 请求关联 / server→client 最低限应答 / 超时取消 / 退出失败。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { key: string; message: string }[] = [];
const spawned: { key: string; command: string }[] = [];
const listeners = new Map<string, (ev: { payload: unknown }) => void>();

vi.mock("@kernel/transport", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "lsp_spawn") spawned.push({ key: args.key as string, command: args.command as string });
    if (cmd === "lsp_send") sent.push({ key: args.key as string, message: args.message as string });
    return null;
  },
  listen: async (name: string, cb: (ev: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  },
  webToken: async () => null,
  isWeb: () => false,
  serverVersion: () => null,
}));

import { closeLspConnection, lspConnectionState, onLspNotification, openLspConnection } from "./lspClient";

function fire(event: string, payload: unknown) {
  listeners.get(event)?.({ payload });
}

function sentJson(): { key: string; message: Record<string, unknown> }[] {
  return sent.slice().map((s) => ({ key: s.key, message: JSON.parse(s.message) as Record<string, unknown> }));
}

const launch = { command: "fake-langserver", args: ["--stdio"] };

beforeEach(() => {
  sent.length = 0;
  spawned.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await closeLspConnection("t1").catch(() => {});
  await closeLspConnection("t2").catch(() => {});
});

describe("openLspConnection", () => {
  it("spawn → initialize → initialized,能力面透出", async () => {
    const opening = openLspConnection({ key: "t1", rootUri: "file:///w", launch, cwd: "/w" });
    await Promise.resolve();
    const init = sentJson().find((s) => s.message.method === "initialize");
    expect(init).toBeDefined();
    expect(init?.key).toBe("t1");
    expect((init?.message.params as { rootUri: string }).rootUri).toBe("file:///w");
    const id = init?.message.id as number;
    fire("lsp://message", { key: "t1", payload: JSON.stringify({ jsonrpc: "2.0", id, result: { capabilities: { hoverProvider: true } } }) });
    const conn = await opening;
    expect(conn.capabilities).toEqual({ hoverProvider: true });
    expect(sentJson().some((s) => s.message.method === "initialized")).toBe(true);
    expect(lspConnectionState("t1")).toBe("ready");
  });

  it("initialize 失败即杀树并抛错", async () => {
    const opening = openLspConnection({ key: "t2", rootUri: "file:///w", launch, cwd: "/w" });
    await Promise.resolve();
    const init = sentJson().find((s) => s.message.method === "initialize");
    fire("lsp://message", { key: "t2", payload: JSON.stringify({ jsonrpc: "2.0", id: init?.message.id, error: { code: -32603, message: "boom" } }) });
    await expect(opening).rejects.toThrow("boom");
    expect(lspConnectionState("t2")).toBe("none");
  });
});

describe("请求关联与 server→client 应答", () => {
  async function readyConn() {
    const opening = openLspConnection({ key: "t1", rootUri: "file:///w", launch, cwd: "/w" });
    await Promise.resolve();
    const init = sentJson().find((s) => s.message.method === "initialize");
    fire("lsp://message", { key: "t1", payload: JSON.stringify({ jsonrpc: "2.0", id: init?.message.id, result: { capabilities: {} } }) });
    return opening;
  }

  it("请求按 id 关联,响应 resolve", async () => {
    const conn = await readyConn();
    sent.length = 0;
    const p = conn.request<{ v: number }>("textDocument/hover", { x: 1 });
    const req = sentJson()[0];
    fire("lsp://message", { key: "t1", payload: JSON.stringify({ jsonrpc: "2.0", id: req.message.id, result: { v: 7 } }) });
    await expect(p).resolves.toEqual({ v: 7 });
  });

  it("server→client workspace/configuration 按 items 回 null 数组", async () => {
    await readyConn();
    sent.length = 0;
    fire("lsp://message", { key: "t1", payload: JSON.stringify({ jsonrpc: "2.0", id: 900, method: "workspace/configuration", params: { items: [{}, {}, {}] } }) });
    const answer = sentJson().at(-1);
    expect(answer?.message.id).toBe(900);
    expect(answer?.message.result).toEqual([null, null, null]);
  });

  it("通知走 onLspNotification 订阅", async () => {
    await readyConn();
    const seen: string[] = [];
    const off = onLspNotification("t1", (msg) => seen.push(String(msg.method)));
    fire("lsp://message", { key: "t1", payload: JSON.stringify({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {} }) });
    expect(seen).toEqual(["textDocument/publishDiagnostics"]);
    off();
    fire("lsp://message", { key: "t1", payload: JSON.stringify({ jsonrpc: "2.0", method: "x/y", params: {} }) });
    expect(seen).toHaveLength(1);
  });

  it("超时发 $/cancelRequest 并 reject;进程退出失败 pending", async () => {
    vi.useFakeTimers();
    const conn = await readyConn();
    sent.length = 0;
    const p = conn.request("textDocument/references", {}, 10_000);
    const req = sentJson()[0];
    vi.advanceTimersByTime(10_001);
    await expect(p).rejects.toThrow("超时");
    expect(sentJson().some((s) => s.message.method === "$/cancelRequest")).toBe(true);
    expect(req.message.method).toBe("textDocument/references");
  });
});
