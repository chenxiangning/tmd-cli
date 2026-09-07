/**
 * DSH host-RPC 浏览器侧客户端(域逻辑,无 UI)—— 线格式同 codemoss host.rs:
 * POST {origin}/api/<method> {type:"client-request",rpcId,method,payload}
 *   → {type:"server-response",rpcId,result:{ok:true,value}|{ok:false,error}}。
 * HTTP 走通用 quota_fetch 通道(R3:插件不 import @tauri-apps/*)。
 * 用途:listSessions/resumeArgs/readSessionStatus 等 CliProfile 钩子的数据源
 * (DSH 会话盘是 zstd 压缩流,fs 文本原语读不了,只能经 host RPC 代读)。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliSessionStatus } from "@kernel/cli";
import type { DshConnection } from "./dshHost";
import { originOf } from "./dshHost";

/** 单次 RPC;失败一律 null(调用方按缺省处理,不猜)。 */
async function rpc<T>(conn: DshConnection, method: string, payload: object): Promise<T | null> {
  try {
    const res = await ipc.quotaFetch({
      url: `${originOf(conn)}/api/${method}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request", rpcId: `tmd-${Date.now()}`, method, payload,
      }),
    });
    const env = res.body as {
      type?: string;
      result?: { ok?: boolean; value?: T };
    } | null;
    if (res.status !== 200 || env?.type !== "server-response" || !env.result?.ok) return null;
    return env.result.value ?? null;
  } catch {
    return null;
  }
}

interface DshSessionListItem {
  sessionId?: string;
  cwd?: string;
  updatedAt?: number;
  projections?: { values?: { title?: string; contextPressure?: DshContextPressure; contextBreakdown?: DshContextBreakdown } };
  blank?: boolean;
}

export interface DshContextPressure {
  pressureTokens?: number;
  projectedTokens?: number;
  contextWindow?: number;
}
export interface DshContextBreakdown {
  systemTokens?: number;
  toolsTokens?: number;
  messageTokens?: number;
}

/** session.list → 该 cwd 的磁盘历史会话(host 全量返回,按 cwd 过滤)。 */
export async function listHostSessions(
  conn: DshConnection, cwd: string,
): Promise<CliDiskSession[]> {
  const value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session.list", {});
  const items = Array.isArray(value?.items) ? value.items : [];
  return items
    .filter((it) => typeof it.sessionId === "string" && it.cwd === cwd && it.blank !== true)
    .map((it) => ({
      id: it.sessionId as string,
      title: it.projections?.values?.title || undefined,
      modifiedAt: typeof it.updatedAt === "number" ? it.updatedAt : 0,
      /* DSH 会话无单文件路径(zstd 流在 host 侧);path 仅调试展示位 */
      path: `${originOf(conn)}/${it.sessionId}`,
    }));
}

/** session.models → 当前模型与思考强度(routable=false 也照读,展示实况)。 */
export async function readHostSessionStatus(
  conn: DshConnection, cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const value = await rpc<{
    current?: { provider?: string; model?: string; reasoningEffort?: string };
  }>(conn, "session.models", { sessionId: cliSessionId });
  const cur = value?.current;
  if (!cur?.model) return null;
  return {
    model: cur.provider ? `${cur.provider}/${cur.model}` : cur.model,
    thinkingLevel: typeof cur.reasoningEffort === "string" ? cur.reasoningEffort : undefined,
  };
}

/** host.describe → 默认状态种子(host 全局 provider/model,新会话未建时的展示位)。 */
export async function readHostDefaultStatus(conn: DshConnection): Promise<CliSessionStatus | null> {
  const value = await rpc<{ provider?: string; model?: string }>(conn, "host.describe", {});
  if (!value?.model) return null;
  return { model: value.provider ? `${value.provider}/${value.model}` : value.model };
}

/** session.list 定位单会话的上下文投影(pressure + 分解,额度弹窗消费)。 */
export async function readHostContextPressure(
  conn: DshConnection, cliSessionId: string,
): Promise<{ used: number; window: number; breakdown?: DshContextBreakdown } | null> {
  const value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session.list", {});
  const it = (value?.items || []).find((s) => s.sessionId === cliSessionId);
  const cp = it?.projections?.values?.contextPressure;
  if (!cp || typeof cp.projectedTokens !== "number" || typeof cp.contextWindow !== "number" || cp.contextWindow <= 0) return null;
  return {
    used: cp.pressureTokens ?? cp.projectedTokens,
    window: cp.contextWindow,
    breakdown: it?.projections?.values?.contextBreakdown,
  };
}
