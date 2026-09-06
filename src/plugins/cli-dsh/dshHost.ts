/**
 * DSH host 连接域逻辑(无 UI,hostPanel 的可测试内核):
 * - 探针 = host.describe RPC:POST {origin}/api/host.describe(codemoss host.rs
 *   同款线格式),走通用 quota_fetch HTTP 通道,内核零配方。
 * - 启动 = PTY 会话跑 `<dsh|自定义路径> web --host H --port P`:会话即 host,
 *   日志在幕布,杀会话即停服务。仅登记本面板拉起的会话 id;外部(终端/mossx)
 *   拉起的 host 一律 adopt 不碰 —— codemoss supervisor「只 kill 自 spawn」同语义。
 * - 连接配置持久化 localStorage(tmd.dsh.connection.v1):host/port/customBin/
 *   autoStart,默认 127.0.0.1:3080 / 空(PATH) / 开 —— 口径对齐 codemoss
 *   DshRuntimeSettings(dshBin/dshHost/dshPort/dshAutoStart 默认值)。
 * - 自动启动语义(codemoss 同款):进首页且 host 未运行时自动拉起;
 *   拨开关不立刻启动或停止。每次应用运行至多自动尝试一次(StrictMode
 *   双挂载安全,consumeAutoStart 一次性闸)。
 */

import { ipc } from "@kernel/ipc";

export const DSH_CONNECTION_KEY = "tmd.dsh.connection.v1";

export interface DshConnection {
  host: string;
  port: number;
  /** 自定义 dsh 可执行路径(绝对路径或 PATH 内名字);空串 = 用 PATH 的 dsh。 */
  customBin: string;
  /** 自动启动主机:进首页且 host 未运行时拉起;拨开关不立刻启停。 */
  autoStart: boolean;
}

export const DEFAULT_CONNECTION: DshConnection = {
  host: "127.0.0.1",
  port: 3080,
  customBin: "",
  autoStart: true,
};

export function loadConnection(): DshConnection {
  try {
    const raw = localStorage.getItem(DSH_CONNECTION_KEY);
    if (!raw) return { ...DEFAULT_CONNECTION };
    const parsed = JSON.parse(raw) as Partial<DshConnection>;
    return {
      host: typeof parsed.host === "string" && parsed.host ? parsed.host : DEFAULT_CONNECTION.host,
      port: typeof parsed.port === "number" && parsed.port > 0 ? parsed.port : DEFAULT_CONNECTION.port,
      customBin: typeof parsed.customBin === "string" ? parsed.customBin : DEFAULT_CONNECTION.customBin,
      autoStart: typeof parsed.autoStart === "boolean" ? parsed.autoStart : DEFAULT_CONNECTION.autoStart,
    };
  } catch {
    return { ...DEFAULT_CONNECTION };
  }
}

export function saveConnection(conn: DshConnection): void {
  localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify(conn));
}

/** 归一 host/port(空 host 回默认,端口截 1-65535),其余字段沿用 base。 */
export function normalizeConnection(
  host: string,
  port: string,
  base: DshConnection = DEFAULT_CONNECTION,
): DshConnection {
  const trimmed = host.trim();
  const parsed = Number.parseInt(port, 10);
  return {
    ...base,
    host: trimmed || DEFAULT_CONNECTION.host,
    port: Number.isFinite(parsed) ? Math.min(65535, Math.max(1, parsed)) : DEFAULT_CONNECTION.port,
  };
}

/** 启动命令:自定义路径优先,回退 PATH 里的 dsh。 */
export function dshCommand(conn: DshConnection): string {
  return conn.customBin.trim() || "dsh";
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

/** dsh 可执行文件是否可用(cli_probe 支持绝对路径与 PATH 名,8s 硬超时)。 */
export async function probeBinary(conn: DshConnection): Promise<boolean> {
  try {
    const res = await ipc.cliProbe(dshCommand(conn));
    return res.found;
  } catch {
    return false;
  }
}

/* ── 自拉起 host 会话登记(模块级 + localStorage;webview 重载不丢,
   重载后仍能停掉同一次应用运行里拉起的 host)── */

const HOST_SESSION_KEY = "tmd.dsh.hostSession.v1";

let hostSessionId: string | null = null;

export function currentHostSessionId(): string | null {
  return hostSessionId ?? localStorage.getItem(HOST_SESSION_KEY);
}

function rememberHostSession(id: string): void {
  hostSessionId = id;
  localStorage.setItem(HOST_SESSION_KEY, id);
}

/** 取走登记(读一次即清,含落盘)。 */
function forgetHostSession(): string | null {
  const id = currentHostSessionId();
  hostSessionId = null;
  localStorage.removeItem(HOST_SESSION_KEY);
  return id;
}

/** 注入式装配 spawn(host.spawnRawSession):裸 ipc.sessionSpawn 不经装配,幕布空白。 */
export type RawSessionSpawner = (
  profileId: string,
  spec: { command: string; args: string[]; cwd: string; title: string },
) => Promise<{ id: string }>;

export async function startHostSession(
  conn: DshConnection,
  spawn: RawSessionSpawner,
): Promise<string> {
  const spawned = await spawn("dsh", {
    command: dshCommand(conn),
    args: ["web", "--no-open", "--host", conn.host, "--port", String(conn.port)],
    cwd: await ipc.configHomeDir(),
    title: "DSH Host",
  });
  rememberHostSession(spawned.id);
  return spawned.id;
}

/** 仅本机 origin 允许停止;远程地址绝不代杀(codemoss is_local_host 同款)。 */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0";
}

export type DshStopOutcome = "stopped" | "remote";

/**
 * codemoss stop_host 同款:杀自spawn 会话 + 按端口停本机监听(外部/遗留
 * host 也能停);远程 origin 拒绝,由调用方提示。 */
export async function stopHostSession(conn: DshConnection): Promise<DshStopOutcome> {
  if (!isLocalHost(conn.host)) return "remote";
  const id = forgetHostSession();
  if (id) await ipc.sessionKill(id).catch(() => undefined);
  await (isWindowsPlatform()
    ? terminateLocalListenerWindows(conn.port)
    : terminateLocalListenerUnix(conn.port));
  return "stopped";
}
/** codemoss ensure_host 同款:已运行直接复用;否则拉起并等就绪(谁在服务都算数)。 */
export async function ensureHostSession(
  conn: DshConnection,
  spawn: RawSessionSpawner,
): Promise<DshHostView | null> {
  const live = await probeHost(conn);
  if (live) return live;
  try {
    await startHostSession(conn, spawn);
  } catch {
    /* spawn 被拒(二进制缺失等):按后续探测结果收口,报错已在会话幕布。 */
  }
  return waitForHostReady(conn);
}

function isWindowsPlatform(): boolean {
  return navigator.userAgent.includes("Windows");
}

/** unix:lsof 找 LISTEN pid → TERM,非零退出补 KILL(codemoss 同款)。 */
async function terminateLocalListenerUnix(port: number): Promise<void> {
  const cwd = await ipc.configHomeDir();
  const scan = await ipc.procCommunicate({
    command: "lsof",
    args: ["-n", "-P", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
    cwd,
    timeoutMs: 8000,
  });
  const pids = scan.stdout.split("\n").map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  if (pids.length === 0) return;
  const term = await ipc.procCommunicate({
    command: "kill",
    args: ["-TERM", ...pids],
    cwd,
    timeoutMs: 8000,
  });
  if (term.code !== 0) {
    await ipc.procCommunicate({
      command: "kill",
      args: ["-KILL", ...pids],
      cwd,
      timeoutMs: 8000,
    }).catch(() => undefined);
  }
}

/** win:netstat 找 LISTENING pid → taskkill /T /F(codemoss 同款解析)。 */
async function terminateLocalListenerWindows(port: number): Promise<void> {
  const cwd = await ipc.configHomeDir();
  const scan = await ipc.procCommunicate({
    command: "netstat",
    args: ["-ano", "-p", "tcp"],
    cwd,
    timeoutMs: 8000,
  });
  const needle = `:${port}`;
  const pids = new Set<string>();
  for (const line of scan.stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[3].toUpperCase() !== "LISTENING") continue;
    if (cols[1].endsWith(needle)) pids.add(cols[4]);
  }
  for (const pid of pids) {
    await ipc.procCommunicate({
      command: "taskkill",
      args: ["/PID", pid, "/T", "/F"],
      cwd,
      timeoutMs: 8000,
    }).catch(() => undefined);
  }
}

/* ── 自动启动(每次应用运行至多一次;StrictMode 双挂载安全)── */

let autoStartConsumed = false;

/** 本挂载是否拥有自动启动权(首次调用 true 并占用闸门)。 */
export function consumeAutoStart(): boolean {
  if (autoStartConsumed) return false;
  autoStartConsumed = true;
  return true;
}

/** 就绪轮询:1.5s × 16 ≈ 24s(codemoss wait_until_ready 同窗口)。 */
export async function waitForHostReady(conn: DshConnection): Promise<DshHostView | null> {
  for (let i = 0; i < 16; i++) {
    await delay(1500);
    const view = await probeHost(conn);
    if (view) return view;
  }
  return null;
}

/** 就绪轮询节拍(Promise.withResolvers 线性控制流)。 */
export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
