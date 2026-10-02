/**
 * DSH host 进程域(无 UI,hostPanel 的可测试内核):探针(settings/describe)、
 * 自拉起/adopt/停机、launch token 凭据链、就绪轮询。连接配置域在 dshConnection.ts。
 */

import { ipc } from "@kernel/ipc";
import {
  authHeaders,
  dshCommand,
  isLocalHost,
  isWildcardBindHost,
  loadConnection,
  originOf,
  type DshConnection,
} from "./dshConnection";
import { startHostSession, stopHostSession, type RawSessionSpawner } from "./dshHostSession";

/** describe 视图:只透传已知字段,未知形状不猜。 */
export interface DshHostView {
  provider?: string;
  model?: string;
  sessions?: number;
}

/** 探针结果:401 = host 活着但缺凭据(与「没起来」必须可分,adopt 语义靠它);
 *  403 = Host/Origin 栅栏拒绝(非 loopback 且未进 DSH trustedHosts)。 */
interface ProbeResult {
  view: DshHostView | null;
  unauthorized: boolean;
  forbidden: boolean;
}

/** quota_fetch 声明 text 后 body 是原文,真 JSON 再解一次(解不动 = null)。 */
function jsonOrNull(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
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

/**
 * 探针 = settings/describe(0.1.2 起 host.describe 删除)。连接级错误归 down。
 *
 * `text: true` 是硬要求:DSH 的 401/403 响应体是纯文本("unauthorized" /
 * "forbidden"),而 quota_fetch 未声明 text 时对 body 做 serde_json::from_str,
 * 解析失败即 Err → invoke reject → 本函数的 catch 把 401 归一成「没起来」,
 * 「host 活着但缺凭据 → 停监听换代自启」整条链在真机永不可达(测试用 mock
 * 绕过了 Rust 解析,所以一直绿)。声明 text 后自己 JSON.parse。 */
export async function probeHost(conn: DshConnection): Promise<ProbeResult> {
  try {
    const res = await ipc.quotaFetch({
      url: `${originOf(conn)}/api/settings/describe`,
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(conn) },
      body: JSON.stringify({ type: "client-request", rpcId: `tmd-${Date.now()}`, method: "settings/describe", payload: { args: {} } }),
      text: true, /* 401/403 是纯文本错误体,不声明会被当 JSON 解析抛错 */
    });
    if (res.status === 401) return { view: null, unauthorized: true, forbidden: false };
    /* 403 = Host/Origin 栅栏拒绝(非 loopback 且未进 DSH trustedHosts)。 */
    if (res.status === 403) return { view: null, unauthorized: false, forbidden: true };
    return { view: parseDescribeResponse(res.status, jsonOrNull(res.body)), unauthorized: false, forbidden: false };
  } catch {
    return { view: null, unauthorized: false, forbidden: false };
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

/** 在途启动闸:侧栏扫盘只在这条 promise 非空时才等 host 就绪(否则白等 24s)。 */
let startInFlight: Promise<DshHostView | null> | null = null;

/** 是否有 host 正在被拉起(侧栏补扫判据)。 */
export function hostStartInFlight(): boolean {
  return startInFlight !== null;
}

/**
 * 装配入口:登记在途启动,供侧栏判「有人在拉起」。
 * 实现体见 ensureHostSessionInner。
 */
export function ensureHostSession(
  conn: DshConnection,
  spawn: RawSessionSpawner,
): Promise<DshHostView | null> {
  const run = ensureHostSessionInner(conn, spawn);
  const tracked: Promise<DshHostView | null> = run.finally(() => {
    if (startInFlight === tracked) startInFlight = null;
  });
  startInFlight = tracked;
  return tracked;
}

async function ensureHostSessionInner(
  conn: DshConnection,
  spawn: RawSessionSpawner,
): Promise<DshHostView | null> {
  const live = await probeHost(conn);
  if (live.view) return live.view;
  /* 非本机 origin 不代拉起也不代杀:spawn 一个本地 `dsh web --host <远程>` 必秒死
     (EADDRNOTAVAIL/栅栏 403),只会白等一轮轮询再把状态判成「连不上」。
     通配监听地址(0.0.0.0/::)DSH 启动期就拒绝,同样不代拉起。 */
  if (!isLocalHost(conn.host) || isWildcardBindHost(conn.host)) return null;
  if (live.unauthorized) {
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
