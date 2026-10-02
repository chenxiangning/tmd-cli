/**
 * DSH host 进程的「自拉起登记 + 停机」域(无 UI)—— 自 dshHost.ts 拆出(300 行铁则):
 * 多槽会话登记(换端口再启动不漏上一代进程)、launch token 抓取与 cookie 落盘、
 * 按端口停本机监听。探针/就绪轮询/自动启动仍在 dshHost.ts。
 */

import { ipc, onPtyOutput } from "@kernel/ipc";
import { getPlatformKind } from "@kernel/platform";
import {
  dshCommand,
  isLocalHost,
  loadConnection,
  originOf,
  saveConnection,
  type DshConnection,
} from "./dshConnection";

/* ── 自拉起 host 会话登记(模块级 + localStorage;webview 重载不丢,
   重载后仍能停掉同一次应用运行里拉起的 host)── */

const HOST_SESSIONS_KEY = "tmd.dsh.hostSessions.v2";
const LEGACY_HOST_SESSION_KEY = "tmd.dsh.hostSession.v1";

/** 登记列表(多槽):换 host/port 再启动时旧 host 进程仍在 LISTENING 并持有
 *  ~/.dsh 会话写锁,单槽登记会把上一代漏成孤儿进程。旧单槽键读时并入迁移。 */
function readHostSessionIds(): string[] {
  let ids: string[] = [];
  try {
    const raw = localStorage.getItem(HOST_SESSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch { /* 解析失败按空表 */ }
  const legacy = localStorage.getItem(LEGACY_HOST_SESSION_KEY);
  if (legacy && !ids.includes(legacy)) ids = [...ids, legacy];
  return ids;
}

function writeHostSessionIds(ids: string[]): void {
  localStorage.setItem(HOST_SESSIONS_KEY, JSON.stringify(ids));
  localStorage.removeItem(LEGACY_HOST_SESSION_KEY);
}

/** 最近一次拉起的 host 会话(幕布/日志入口用)。 */
export function currentHostSessionId(): string | null {
  return readHostSessionIds().at(-1) ?? null;
}

function rememberHostSession(id: string): void {
  writeHostSessionIds([...readHostSessionIds(), id]);
}

/** 取走全部登记(读一次即清,含落盘)。 */
function forgetHostSessions(): string[] {
  const ids = readHostSessionIds();
  writeHostSessionIds([]);
  return ids;
}

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
    /* 交换窗口最长 20s,期间用户可能改了 host/port:cookie 按 authority 签名绑定,
       merge 进新 origin 会得到「永久 401 + 停监听误杀新端口」的错配,扔掉。 */
    const now = loadConnection();
    if (originOf(now) !== originOf(conn)) return;
    saveConnection({ ...now, cookie, launchToken: token });
  } catch { /* 交换失败 = 后续探针 401,走 ensure 的重启收口 */ }
}

/* 平台判定统一走 kernel/platform(UA 小写化 + unknown 兜底链),不自造。 */
const isWindowsPlatform = () => getPlatformKind() === "windows";

type DshStopOutcome = "stopped" | "remote";

/**
 * codemoss stop_host 同款:杀自spawn 会话 + 按端口停本机监听(外部/遗留
 * host 也能停);远程 origin 拒绝,由调用方提示。 */
export async function stopHostSession(conn: DshConnection): Promise<DshStopOutcome> {
  if (!isLocalHost(conn.host)) return "remote";
  const ids = forgetHostSessions();
  /* 各会话 kill 互不依赖,并发(同 terminateLocalListenerWindows 的 taskkill);失败逐个吞掉。 */
  await Promise.all(ids.map((id) => ipc.sessionKill(id).catch(() => undefined)));
  await (isWindowsPlatform()
    ? terminateLocalListenerWindows(conn.port)
    : terminateLocalListenerUnix(conn.port));
  return "stopped";
}
/**
 * codemoss ensure_host 同款:已运行直接复用;否则拉起并等就绪。
 * 0.1.2 新语义:401 = 外部 host 且无凭据 —— 本机则停掉监听换代自启
 * (凭据归我们管),远程无法代管,直接报未运行。

const isWindowsPlatform = () => getPlatformKind() === "windows";

/** unix:lsof 找 LISTEN pid → TERM,非零退出补 KILL(codemoss 同款)。
 *  lsof/kill 探针全程容错:缺席/超时即跳过 —— 此链任何 reject 都会让
 *  hostPanel 的 pending 永卡「正在停止…」(onStop 无 try/catch)。 */
async function terminateLocalListenerUnix(port: number): Promise<void> {
  const cwd = await ipc.configHomeDir().catch(() => null);
  if (!cwd) return;
  const scan = await ipc.procCommunicate({
    command: "lsof",
    args: ["-n", "-P", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
    cwd,
    timeoutMs: 8000,
  }).catch(() => null);
  if (!scan) return;
  const pids = scan.stdout.split("\n").map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  if (pids.length === 0) return;
  const term = await ipc.procCommunicate({
    command: "kill",
    args: ["-TERM", ...pids],
    cwd,
    timeoutMs: 8000,
  }).catch(() => null);
  if (term && term.code !== 0) {
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
  const cwd = await ipc.configHomeDir().catch(() => null);
  if (!cwd) return;
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
  /* 各 pid 的 taskkill 互不依赖,并发;pids 常为 1 个,失败逐个吞掉。 */
  await Promise.all(
    [...pids].map((pid) =>
      ipc.procCommunicate({
        command: "taskkill",
        args: ["/PID", pid, "/T", "/F"],
        cwd,
        timeoutMs: 8000,
      }).catch(() => undefined),
    ),
  );
}
