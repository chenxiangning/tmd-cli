/**
 * DSH host 进程域(无 UI,hostPanel 的可测试内核):探针(settings/describe)、
 * 自拉起/adopt/停机、launch token 凭据链、就绪轮询。连接配置域在 dshConnection.ts。
 */

import { ipc, onPtyOutput } from "@kernel/ipc";
import { getPlatformKind } from "@kernel/platform";
import {
  authHeaders,
  dshCommand,
  isLocalHost,
  loadConnection,
  originOf,
  saveConnection,
  type DshConnection,
} from "./dshConnection";


/** describe 视图:只透传已知字段,未知形状不猜。 */
export interface DshHostView {
  provider?: string;
  model?: string;
  sessions?: number;
}

/** 探针结果:401 = host 活着但缺凭据(与「没起来」必须可分,adopt 语义靠它)。 */
export interface ProbeResult {
  view: DshHostView | null;
  unauthorized: boolean;
}

/** server-response 信封 → 视图;非 server-response / ok:false → null。 */
export function parseDescribeResponse(status: number, body: unknown): DshHostView | null {
  if (status !== 200) return null;
  /* settings/describe:provider/model 在 namespaces[ns=agent-default-model].value。 */
  if (typeof body !== "object" || body === null || !("type" in body) || body.type !== "server-response") return null;
  if (!("result" in body) || typeof body.result !== "object" || body.result === null) return null;
  if (!("ok" in body.result) || body.result.ok !== true) return null;
  if (!("value" in body.result) || typeof body.result.value !== "object" || body.result.value === null) return {};
  if (!("namespaces" in body.result.value) || !Array.isArray(body.result.value.namespaces)) return {};
  const view: DshHostView = {};
  for (const entry of body.result.value.namespaces) {
    if (typeof entry !== "object" || entry === null || !("ns" in entry) || entry.ns !== "agent-default-model") continue;
    if (!("value" in entry) || typeof entry.value !== "object" || entry.value === null) continue;
    if ("provider" in entry.value && typeof entry.value.provider === "string") view.provider = entry.value.provider;
    if ("model" in entry.value && typeof entry.value.model === "string") view.model = entry.value.model;
  }
  return view;
}

/** 探针 = settings/describe(0.1.2 起 host.describe 删除)。连接级错误归 down。 */
export async function probeHost(conn: DshConnection): Promise<ProbeResult> {
  try {
    const res = await ipc.quotaFetch({
      url: `${originOf(conn)}/api/settings/describe`,
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(conn) },
      body: JSON.stringify({ type: "client-request", rpcId: `tmd-${Date.now()}`, method: "settings/describe", payload: { args: {} } }),
    });
    if (res.status === 401) return { view: null, unauthorized: true };
    return { view: parseDescribeResponse(res.status, res.body), unauthorized: false };
  } catch {
    return { view: null, unauthorized: false };
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

/**
 * host 会话 = 后台基础设施(spawner 传 activate:false);--no-open 防自弹浏览器。
 * 0.1.2 起 host 打印一次性 launch token:spawn 后订阅 PTY 输出抓 token 换
 * cookie 落盘(20s 封顶;探针就绪判定依赖 cookie 先行落盘)。
 */
export async function startHostSession(
  conn: DshConnection,
  spawn: RawSessionSpawner,
): Promise<string> {
  const spawned = await spawn("dsh", {
    command: dshCommand(conn),
    args: ["web", "--host", conn.host, "--port", String(conn.port), "--no-open"],
    cwd: await ipc.configHomeDir(),
    title: "DSH Host",
  });
  rememberHostSession(spawned.id);
  await captureLaunchToken(conn, spawned.id);
  return spawned.id;
}

/** PTY 输出抓 `[?&]token=` → 换 cookie → 落盘;20s 未见到 token 静默放弃。 */
async function captureLaunchToken(conn: DshConnection, sessionId: string): Promise<void> {
  await new Promise<void>((resolve) => {
    let buf = "";
    let done = false;
    let unlisten: (() => void) | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      unlisten?.();
      resolve();
    };
    void onPtyOutput(sessionId, (text: string) => {
      if (done) return;
      buf += text;
      const m = buf.match(/[?&]token=([A-Za-z0-9_-]+)/);
      if (!m) return;
      void exchangeAndSave(conn, m[1]).finally(finish);
    }).then((off) => {
      unlisten = off;
      if (done) off();
    });
    setTimeout(finish, 20_000);
  });
}

/** launch token → 303 set-cookie(经 quota_fetch 不跟随重定向+回带头)。 */
async function exchangeAndSave(conn: DshConnection, token: string): Promise<void> {
  try {
    const res = await ipc.quotaFetch({
      url: `${originOf(conn)}/?token=${encodeURIComponent(token)}`,
      method: "GET",
      noRedirect: true,
      includeHeaders: true,
      text: true, /* 303 的 body 不是 JSON,不声明会被 quota_fetch 当 JSON 解析抛错 */
    });
    const raw = res.headers?.["set-cookie"]?.[0];
    const cookie = raw?.split(";")[0];
    if (res.status !== 303 || !cookie) return;
    saveConnection({ ...loadConnection(), cookie, launchToken: token });
  } catch { /* 交换失败 = 后续探针 401,走 ensure 的重启收口 */ }
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
/**
 * codemoss ensure_host 同款:已运行直接复用;否则拉起并等就绪。
 * 0.1.2 新语义:401 = 外部 host 且无凭据 —— 本机则停掉监听换代自启
 * (凭据归我们管),远程无法代管,直接报未运行。
 */
export async function ensureHostSession(
  conn: DshConnection,
  spawn: RawSessionSpawner,
): Promise<DshHostView | null> {
  const live = await probeHost(conn);
  if (live.view) return live.view;
  if (live.unauthorized) {
    if (!isLocalHost(conn.host)) return null;
    await stopHostSession(conn);
    await delay(600);
  }
  try {
    await startHostSession(conn, spawn);
  } catch {
    /* spawn 被拒(二进制缺失等):按后续探测结果收口,报错已在会话幕布。 */
  }
  /* spawn 后 cookie 刚落盘:必须重读连接配置,拿旧 conn 探测只会 401。 */
  return waitForHostReady(loadConnection());
}

/* 平台判定统一走 kernel/platform(UA 小写化 + unknown 兜底链),不自造。 */
const isWindowsPlatform = () => getPlatformKind() === "windows";

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
    const probe = await probeHost(conn);
    if (probe.view) return probe.view;
    if (probe.unauthorized) return null; /* 无凭据的 host 等不来授权,快速失败 */
  }
  return null;
}

/** 就绪轮询节拍(Promise.withResolvers 线性控制流)。 */
export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
