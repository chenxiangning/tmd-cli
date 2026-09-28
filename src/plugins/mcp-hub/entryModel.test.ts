/**
 * mcp-hub/entryModel + probe 契约测试 —— transport 推断/摘要/密钥掩码 +
 * 探活分发(stdio → Rust mcpProbe;http/sse → 前端 quotaFetch 握手)。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mcpProbe: vi.fn(), quotaFetch: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: { mcpProbe: mocks.mcpProbe, quotaFetch: mocks.quotaFetch } }));

import { inferTransport, isSecretishKey, maskValue, summarizeEntry } from "./entryModel";
import { probeServer } from "./probe";

describe("entryModel", () => {
  it("transport 推断:显式 type 优先(streamable-http 归 http);缺省 command→stdio / url→http", () => {
    expect(inferTransport({ type: "stdio", command: "x" })).toBe("stdio");
    expect(inferTransport({ type: "http", url: "u" })).toBe("http");
    expect(inferTransport({ type: "streamable-http", url: "u" })).toBe("http");
    expect(inferTransport({ type: "sse" })).toBe("sse");
    expect(inferTransport({ command: "npx", args: ["a"] })).toBe("stdio");
    expect(inferTransport({ url: "https://x" })).toBe("http");
    expect(inferTransport({})).toBe("stdio"); // 空表单基线
  });

  it("摘要行:stdio = command + args;remote = url;空 = —", () => {
    expect(summarizeEntry({ command: "npx", args: ["-y", "a"] })).toBe("npx -y a");
    expect(summarizeEntry({ type: "http", url: "https://x/mcp" })).toBe("https://x/mcp");
    expect(summarizeEntry({})).toBe("—");
  });

  it("密钥掩码:疑似密钥列固定掩码(长度也不泄漏);普通键明文", () => {
    expect(isSecretishKey("Authorization")).toBe(true);
    expect(isSecretishKey("BRAVE_API_KEY")).toBe(true);
    expect(maskValue("api_token", "sk-secret-value")).toBe("••••••");
    expect(maskValue("name", "plain")).toBe("plain");
    expect(maskValue("api_token", "")).toBe("");
  });
});

describe("probeServer 分发", () => {
  it("stdio → ipc.mcpProbe(command/args/env,15s);结果透传 + 延迟", async () => {
    mocks.mcpProbe.mockResolvedValue({ ok: true, serverName: "s", serverVersion: "1", toolsCount: 4 });
    const r = await probeServer({ command: "npx", args: ["-y", "a"], env: { K: "v" } });
    expect(mocks.mcpProbe).toHaveBeenCalledWith({
      command: "npx",
      args: ["-y", "a"],
      env: { K: "v" },
      timeoutMs: 15000,
    });
    expect(r.ok).toBe(true);
    expect(r.toolsCount).toBe(4);
    expect(typeof r.latencyMs).toBe("number");
  });

  it("stdio 缺 command / remote 缺 url = 即时失败不触网络", async () => {
    expect((await probeServer({})).error).toBe("缺少 command");
    expect((await probeServer({ type: "http", headers: {} })).error).toBe("缺少 url");
    expect(mocks.mcpProbe).not.toHaveBeenCalled();
  });

  it("http → quotaFetch POST initialize(SSE data: 行解析 serverInfo)", async () => {
    mocks.quotaFetch.mockResolvedValue({
      status: 200,
      body: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"srv","version":"2.0"}}}\n\n',
    });
    const r = await probeServer({ type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer k" } });
    const spec = mocks.quotaFetch.mock.calls[0][0];
    expect(spec.method).toBe("POST");
    expect(spec.url).toBe("https://x/mcp");
    expect(spec.headers.accept).toContain("text/event-stream");
    expect(spec.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(spec.body).method).toBe("initialize");
    expect(r.ok).toBe(true);
    expect(r.serverName).toBe("srv");
    expect(r.serverVersion).toBe("2.0");
  });

  it("http 非 2xx / JSON-RPC error = 失败带文案", async () => {
    mocks.quotaFetch.mockResolvedValue({ status: 503, body: "" });
    expect((await probeServer({ type: "http", url: "https://x" })).error).toBe("HTTP 503");
    mocks.quotaFetch.mockResolvedValue({
      status: 200,
      body: '{"jsonrpc":"2.0","id":1,"error":{"message":"not authorized"}}',
    });
    expect((await probeServer({ type: "http", url: "https://x" })).error).toBe("not authorized");
  });
});
