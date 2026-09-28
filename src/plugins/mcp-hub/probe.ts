/**
 * 连通测试编排 —— 一次性探活,不产生任何持久状态(无长驻 session/注册表)。
 * stdio → Rust mcp_probe(spawn → initialize → tools/list → kill,15s);
 * http/sse → 前端 quotaFetch POST initialize(Accept 双型),应答即判可达。
 * 结果由调用方(ServersView 行内徽标)持有,超时/失败附错误文案。
 */

import { ipc } from "@kernel/ipc";
import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";
import { inferTransport } from "./entryModel";

export interface ProbeResult {
  ok: boolean;
  serverName?: string;
  serverVersion?: string;
  toolsCount?: number;
  latencyMs: number;
  error?: string;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function stringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

/** stdio 握手走 Rust 一次性探针(协议版本自新向旧由服务端协商,错误附 stderr 尾)。 */
async function probeStdio(entry: McpServerEntry, startedAt: number): Promise<ProbeResult> {
  if (typeof entry.command !== "string" || !entry.command.trim()) {
    return { ok: false, latencyMs: 0, error: "缺少 command" };
  }
  try {
    const r = await ipc.mcpProbe({
      command: entry.command,
      args: stringArray(entry.args),
      env: stringRecord(entry.env),
      timeoutMs: 15000,
    });
    return { ...r, latencyMs: Date.now() - startedAt };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: e instanceof Error ? e.message : String(e) };
  }
}

/** http/sse 握手:POST initialize(Accept json + event-stream 双型);
 *  2xx 且响应含 JSON-RPC result 即可达,顺带取 serverInfo 与 tools 提示。 */
async function probeHttp(url: string, headers: Record<string, string>, startedAt: number): Promise<ProbeResult> {
  /* 延迟在握手完成后取值(await 前取恒为 ~0)。 */
  try {
    const res = await ipc.quotaFetch({
      url,
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tmd-cli", version: "0.1" } },
      }),
      text: true,
    });
    const latencyMs = Date.now() - startedAt;
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? "");
    /* SSE 事件流应答:取首个 data: 行的 JSON;纯 JSON 应答:直接解析。 */
    const dataLine = body
      .split("\n")
      .map((l) => l.replace(/^data:\s?/, ""))
      .find((l) => l.trim().startsWith("{"));
    const parsed = dataLine ? (JSON.parse(dataLine) as Record<string, unknown>) : null;
    const result = (parsed?.result ?? null) as Record<string, unknown> | null;
    if (parsed && parsed.error) {
      const msg = (parsed.error as Record<string, unknown>).message;
      return { ok: false, latencyMs, error: typeof msg === "string" ? msg : "initialize 被拒" };
    }
    if (!result) return { ok: true, latencyMs }; // 可达但无应答体(网关直通等),不猜细节
    const info = (result.serverInfo ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      latencyMs,
      serverName: typeof info.name === "string" ? info.name : undefined,
      serverVersion: typeof info.version === "string" ? info.version : undefined,
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 按条目 transport 分发(stdio → Rust;http/sse → 前端握手)。 */
export async function probeServer(entry: McpServerEntry): Promise<ProbeResult> {
  const startedAt = Date.now();
  if (inferTransport(entry) === "stdio") return probeStdio(entry, startedAt);
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url) return { ok: false, latencyMs: 0, error: "缺少 url" };
  return probeHttp(url, stringRecord(entry.headers), startedAt);
}
