/* ── 公共小工具(仅 vendors/ 目录内共享,不进 barrel)─────────── */

import { ipc } from "@kernel/ipc";
import type { QuotaWindow } from "@kernel/quota";

export function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** reset 字段归一 → ms epoch。数字:>1e12 视为 ms,>1e9 视为秒;字符串走 Date.parse。 */
export function extractResetTime(v: unknown): number | undefined {
  const n = asNum(v);
  if (n !== undefined) {
    if (n > 1e12) return n;
    if (n > 1e9) return n * 1000;
    return undefined;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

export function twoDecimals(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/** quotaFetch 封装 + 统一报错:401/403 → 鉴权失败;非 2xx → HTTP x + 截断 body。 */
export async function httpJson(spec: {
  url: string;
  headers: Record<string, string>;
}): Promise<unknown> {
  const resp = await ipc.quotaFetch({ url: spec.url, method: "GET", headers: spec.headers });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`鉴权失败 (HTTP ${resp.status})`);
  }
  if (resp.status < 200 || resp.status >= 300) {
    const hint = JSON.stringify(resp.body)?.slice(0, 200) ?? "";
    throw new Error(`HTTP ${resp.status}${hint ? `: ${hint}` : ""}`);
  }
  return resp.body;
}

export function window(label: string, usedPercent: number, resetsAt?: number): QuotaWindow {
  const pct = Math.round(Math.min(100, Math.max(0, usedPercent)));
  return resetsAt ? { label, displayPercent: pct, resetsAt } : { label, displayPercent: pct };
}
