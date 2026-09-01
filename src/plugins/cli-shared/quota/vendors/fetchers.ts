/* ── key 型供应商 fetcher: kimi / minimax / zhipu / deepseek ──── */

import type { QuotaWindow } from "@kernel/quota";
import { asNum, extractResetTime, httpJson, window } from "./http";
import type { VendorQuota } from "./types";

/* ── kimi ─────────────────────────────────────────────── */

export async function fetchKimi(token: string): Promise<VendorQuota> {
  const body = (await httpJson({
    url: "https://api.kimi.com/coding/v1/usages",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  })) as {
    limits?: Array<{ detail?: { limit?: unknown; remaining?: unknown; resetTime?: unknown } }>;
    usage?: { limit?: unknown; remaining?: unknown; resetTime?: unknown };
  };

  const toWin = (
    label: string,
    d?: { limit?: unknown; remaining?: unknown; resetTime?: unknown },
  ): QuotaWindow | null => {
    if (!d) return null;
    const limit = asNum(d.limit) ?? 0;
    if (limit <= 0) return null;
    const remaining = asNum(d.remaining) ?? 0;
    return window(label, ((limit - remaining) / limit) * 100, extractResetTime(d.resetTime));
  };

  const windows = [
    toWin("5小时", body.limits?.[0]?.detail),
    toWin("7天", body.usage),
  ].filter((w): w is QuotaWindow => w !== null);
  return { windows };
}

/* ── minimax ──────────────────────────────────────────── */

export async function fetchMinimax(key: string, isCn: boolean): Promise<VendorQuota> {
  const domain = isCn ? "api.minimaxi.com" : "api.minimax.io";
  const body = (await httpJson({
    url: `https://${domain}/v1/api/openplatform/coding_plan/remains`,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  })) as {
    base_resp?: { status_code?: number; status_msg?: string };
    model_remains?: Array<{
      model_name?: string;
      current_interval_remaining_percent?: number;
      end_time?: number;
      current_weekly_status?: number;
      current_weekly_remaining_percent?: number;
      weekly_end_time?: number;
    }>;
  };

  if (body.base_resp && (body.base_resp.status_code ?? -1) !== 0) {
    throw new Error(
      `MiniMax API 错误 (code ${body.base_resp.status_code}): ${body.base_resp.status_msg ?? "未知"}`,
    );
  }

  const item = body.model_remains?.find((m) => m.model_name === "general");
  if (!item) return { windows: [] };

  const windows: QuotaWindow[] = [];
  if (typeof item.current_interval_remaining_percent === "number") {
    windows.push(
      window("5小时", 100 - item.current_interval_remaining_percent, extractResetTime(item.end_time)),
    );
  }
  if (
    item.current_weekly_status === 1 &&
    typeof item.current_weekly_remaining_percent === "number"
  ) {
    windows.push(
      window("7天", 100 - item.current_weekly_remaining_percent, extractResetTime(item.weekly_end_time)),
    );
  }
  return { windows };
}

/* ── zhipu(智谱 / z.ai)───────────────────────────────── */

interface ZhipuLimitBody {
  success?: boolean;
  msg?: string;
  data?: {
    level?: string;
    limits?: Array<{
      type?: string;
      unit?: number;
      percentage?: unknown;
      UsagePercent?: unknown;
      usagePercent?: unknown;
      nextResetTime?: unknown;
      resetTime?: unknown;
    }>;
  };
}

/** 智谱响应 → 窗口(纯函数,可测)。unit 3 → 5h;unit 6 → 周窗口;缺失时按 nextResetTime 启发式。 */
export function parseZhipuLimit(body: ZhipuLimitBody): VendorQuota {
  if (body.success === false) {
    throw new Error(`智谱 API 错误: ${body.msg ?? "未知"}`);
  }
  const data = body.data;
  if (!data) throw new Error("智谱响应缺 data 字段");

  // 对齐 CC Switch: unit 3 → 5h;unit 6 → 周窗口;缺失时按 nextResetTime 启发式
  let fiveHour: QuotaWindow | undefined;
  let weekly: QuotaWindow | undefined;
  const unclassified: Array<{ resetMs?: number; w: QuotaWindow }> = [];
  for (const item of data.limits ?? []) {
    if (item.type && item.type.toLowerCase() !== "tokens_limit") continue;
    const pct = asNum(item.percentage) ?? asNum(item.UsagePercent) ?? asNum(item.usagePercent) ?? 0;
    const resetsAt = extractResetTime(item.nextResetTime) ?? extractResetTime(item.resetTime);
    const resetMs = asNum(item.nextResetTime);
    if (item.unit === 3 && !fiveHour) {
      fiveHour = window("5小时", pct, resetsAt);
    } else if (item.unit === 6 && !weekly) {
      weekly = window("7天", pct, resetsAt);
    } else {
      unclassified.push({ resetMs, w: window("", pct, resetsAt) });
    }
  }
  // 无 reset 的排前(5h 桶 0% 时常缺 reset);其余按 reset 升序补空位
  unclassified.sort((a, b) => Number(a.resetMs !== undefined) - Number(b.resetMs !== undefined) || (a.resetMs ?? -Infinity) - (b.resetMs ?? -Infinity));
  for (const u of unclassified) {
    if (!fiveHour) fiveHour = { ...u.w, label: "5小时" };
    else if (!weekly) weekly = { ...u.w, label: "7天" };
  }

  const windows = [fiveHour, weekly].filter((w): w is QuotaWindow => w !== undefined);
  const quota: VendorQuota = { windows };
  if (data.level) quota.planLabel = data.level;
  return quota;
}

export async function fetchZhipu(key: string, isCn: boolean): Promise<VendorQuota> {
  const host = isCn ? "https://open.bigmodel.cn" : "https://api.z.ai";
  const body = (await httpJson({
    url: `${host}/api/monitor/usage/quota/limit`,
    // 智谱:Authorization 不加 Bearer 前缀
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en",
    },
  })) as ZhipuLimitBody;
  return parseZhipuLimit(body);
}

/* ── deepseek(余额型)─────────────────────────────────── */

export async function fetchDeepseek(key: string): Promise<VendorQuota> {
  const body = (await httpJson({
    url: "https://api.deepseek.com/user/balance",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })) as {
    is_available?: boolean;
    balance_infos?: Array<{ currency?: string; total_balance?: string }>;
  };

  const info = body.balance_infos?.[0];
  const currency = info?.currency?.trim() || "UNKNOWN";
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
  return {
    windows: [],
    balanceText: `${symbol}${info?.total_balance ?? "0"}`,
    planLabel: body.is_available ? "available" : "unavailable",
  };
}
