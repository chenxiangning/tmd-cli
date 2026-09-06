/**
 * DSH host 连接域逻辑(无 UI,hostPanel 的可测试内核):
 * - 探针 = host.describe RPC:POST {origin}/api/host.describe,线格式
 *   {type:"client-request",rpcId,method,payload} → {type:"server-response",
 *   rpcId,result:{ok,value}|{ok,error}}(codemoss host.rs 同款),走通用
 *   quota_fetch HTTP 通道,内核零配方。
 * - 启动 = PTY 会话跑 `dsh web --host H --port P`:会话即 host,日志在幕布,
 *   杀会话即停服务。仅登记本面板拉起的会话 id;外部(终端/mossx)拉起的 host
 *   一律 adopt 不碰 —— codemoss supervisor「只 kill 自 spawn」同语义。
 * - host/port 持久化 localStorage(tmd.dsh.connection.v1,默认 127.0.0.1:3080,
 *   同 codemoss DshRuntimeSettings 默认值)。
 */

import { ipc } from "@kernel/ipc";

export const DSH_CONNECTION_KEY = "tmd.dsh.connection.v1";

export interface DshConnection {
  host: string;
  port: number;
}

export const DEFAULT_CONNECTION: DshConnection = { host: "127.0.0.1", port: 3080 };

export function loadConnection(): DshConnection {
  try {
    const raw = localStorage.getItem(DSH_CONNECTION_KEY);
    if (!raw) return { ...DEFAULT_CONNECTION };
    const parsed = JSON.parse(raw) as Partial<DshConnection>;
    return {
      host: typeof parsed.host === "string" && parsed.host ? parsed.host : DEFAULT_CONNECTION.host,
      port: typeof parsed.port === "number" && parsed.port > 0 ? parsed.port : DEFAULT_CONNECTION.port,
    };
  } catch {
    return { ...DEFAULT_CONNECTION };
  }
}

export function saveConnection(conn: DshConnection): void {
  localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify(conn));
}

/** 归一输入:空 host 回默认;端口截到 1-65535。 */
export function normalizeConnection(host: string, port: string): DshConnection {
  const trimmed = host.trim();
  const parsed = Number.parseInt(port, 10);
  return {
    host: trimmed || DEFAULT_CONNECTION.host,
    port: Number.isFinite(parsed) ? Math.min(65535, Math.max(1, parsed)) : DEFAULT_CONNECTION.port,
  };
}

export function originOf(conn: DshConnection): string {
  return `http://${conn.host}:${conn.port}`;
}

/** host.describe 请求体(codemoss host.rs 线格式)。 */
export function describeRequestBody(rpcId: string): string {
  return JSON.stringify({ type: "client-request", rpcId, method: "host.describe", payload: {} });
}

/** describe 视图:只透传已知字段,未知形状不猜。 */
export interface DshHostView {
  provider?: string;
  model?: string;
  sessions?: number;
}

/** server-response 信封 → 视图;非 200 / 非 server-response / ok:false → null。 */
export function parseDescribeResponse(status: number, body: unknown): DshHostView | null {
  if (status !== 200) return null;
  const envelope = body as {
    type?: string;
    result?: { ok?: boolean; value?: Record<string, unknown> };
  } | null;
  if (!envelope || envelope.type !== "server-response" || !envelope.result?.ok) return null;
  /* 200 + ok 即 host 存活;字段不可读(非对象/缺字段)归为空视图,不判死。 */
  const value = envelope.result.value;
  const view: DshHostView = {};
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.provider === "string") view.provider = record.provider;
    if (typeof record.model === "string") view.model = record.model;
    if (typeof record.sessions === "number") view.sessions = record.sessions;
  }
  return view;
}

export async function probeHost(conn: DshConnection): Promise<DshHostView | null> {
  try {
    const res = await ipc.quotaFetch({
      url: `${originOf(conn)}/api/host.describe`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: describeRequestBody(`tmd-${Date.now()}`),
    });
    return parseDescribeResponse(res.status, res.body);
  } catch {
    return null;
  }
}

/* ── 自拉起 host 会话登记(模块级;仅停止按钮消费)── */

let hostSessionId: string | null = null;

export function currentHostSessionId(): string | null {
  return hostSessionId;
}

export async function startHostSession(conn: DshConnection): Promise<string> {
  const spawned = await ipc.sessionSpawn("dsh", {
    command: "dsh",
    args: ["web", "--host", conn.host, "--port", String(conn.port)],
    cwd: await ipc.configHomeDir(),
    title: "DSH Host",
  });
  hostSessionId = spawned.id;
  return spawned.id;
}

/** 只停自拉起会话;外部 host 返回 false(调用方给提示)。 */
export async function stopHostSession(): Promise<boolean> {
  if (!hostSessionId) return false;
  const id = hostSessionId;
  hostSessionId = null;
  await ipc.sessionKill(id);
  return true;
}

/** 就绪轮询节拍(Promise.withResolvers 线性控制流)。 */
export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
