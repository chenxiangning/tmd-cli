/* ── openai-codex(ChatGPT 套餐,wham HTTP 降级路径)────────── */

import type { QuotaWindow } from "@kernel/quota";
import { asNum, extractResetTime, httpJson, window } from "./http";
import type { VendorQuota } from "./types";

interface CodexWindow {
  used_percent?: unknown;
  usedPercent?: unknown;
  limit_window_seconds?: unknown;
  windowDurationMins?: unknown;
  reset_at?: unknown;
  resetAt?: unknown;
}

interface CodexRateLimit {
  primary_window?: CodexWindow | null;
  secondary_window?: CodexWindow | null;
}

interface CodexUsageResponse extends CodexRateLimit {
  plan_type?: string;
  rate_limit?: CodexRateLimit | null;
  additional_rate_limits?: Array<{ rate_limit?: CodexRateLimit | null }>;
}

function codexWindowLabel(rawWindow: CodexWindow, slot: "primary" | "secondary"): string {
  const seconds = asNum(rawWindow.limit_window_seconds);
  const minutes =
    asNum(rawWindow.windowDurationMins) ??
    (seconds !== undefined ? seconds / 60 : undefined);
  if (minutes !== undefined && minutes > 0) {
    if (minutes === 300) return "5小时";
    if (minutes === 10080) return "7天";
    if (minutes % 1440 === 0) return `${minutes / 1440}天`;
    if (minutes % 60 === 0) return `${minutes / 60}小时`;
    return `${minutes}分钟`;
  }
  // 兼容旧响应没有 duration 的情况;有 duration 时绝不按槽位猜语义。
  return slot === "primary" ? "5小时" : "7天";
}

function codexWindowOrder(label: string): number {
  if (label === "5小时") return 0;
  if (label === "7天") return 1;
  return 2;
}

/**
 * WHAM 响应 → 窗口(纯函数,可测)。
 * primary/secondary 是槽位名;5h 可能在 additional_rate_limits,
 * 因此按 limit_window_seconds 归类,同一窗口优先使用主 rate_limit 数据。
 */
export function aggregateCodexUsage(body: CodexUsageResponse): VendorQuota {
  const rateLimits: CodexRateLimit[] = [];
  const primaryRateLimit =
    body.rate_limit ??
    (body.primary_window || body.secondary_window ? body : null);
  if (primaryRateLimit) rateLimits.push(primaryRateLimit);
  for (const additional of body.additional_rate_limits ?? []) {
    if (additional.rate_limit) rateLimits.push(additional.rate_limit);
  }

  const windowsByLabel = new Map<string, QuotaWindow>();
  for (const rateLimit of rateLimits) {
    for (const [slot, rawWindow] of [
      ["primary", rateLimit.primary_window],
      ["secondary", rateLimit.secondary_window],
    ] as const) {
      if (!rawWindow) continue;
      const usedPercent = asNum(rawWindow.used_percent) ?? asNum(rawWindow.usedPercent);
      if (usedPercent === undefined) continue;
      const label = codexWindowLabel(rawWindow, slot);
      if (!windowsByLabel.has(label)) {
        windowsByLabel.set(
          label,
          window(
            label,
            usedPercent,
            extractResetTime(rawWindow.reset_at) ?? extractResetTime(rawWindow.resetAt),
          ),
        );
      }
    }
  }

  const windows = [...windowsByLabel.entries()]
    .sort(([a], [b]) => codexWindowOrder(a) - codexWindowOrder(b))
    .map(([, quotaWindow]) => quotaWindow);
  const quota: VendorQuota = { windows };
  if (body.plan_type?.trim()) quota.planLabel = body.plan_type.trim();
  return quota;
}

export async function fetchOpenaiCodex(access: string, accountId: string): Promise<VendorQuota> {
  const body = (await httpJson({
    url: "https://chatgpt.com/backend-api/wham/usage",
    headers: {
      Authorization: `Bearer ${access}`,
      "chatgpt-account-id": accountId,
      originator: "codex_cli_rs",
      Accept: "application/json",
    },
  })) as CodexUsageResponse;
  return aggregateCodexUsage(body);
}
