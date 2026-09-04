/* ── relay(未知中转站: Sub2API → New API 回退)──────────── */

import type { QuotaWindow } from "@kernel/quota";
import { asNum, extractResetTime, httpJson, twoDecimals, window } from "./http";
import type { VendorQuota } from "./types";

function relayOrigin(baseUrl: string): string {
  const raw = baseUrl.trim().split("?")[0].replace(/\/+$/, "");
  const m = /^(https?:\/\/)([^/]+)/.exec(raw);
  if (!m) throw new Error(`base_url 不是合法 http(s) URL: ${baseUrl}`);
  return `${m[1]}${m[2]}`;
}

function sub2apiUsageUrl(baseUrl: string): string {
  const raw = baseUrl.trim().split("?")[0].replace(/\/+$/, "");
  const m = /^(https?:\/\/)([^/]+)(.*)$/.exec(raw);
  if (!m) throw new Error(`base_url 不是合法 http(s) URL: ${baseUrl}`);
  let path = m[3] ?? "";
  for (const suffix of ["/chat/completions", "/messages", "/responses", "/completions"]) {
    if (path.toLowerCase().endsWith(suffix)) {
      path = path.slice(0, path.length - suffix.length);
      break;
    }
  }
  path = path.replace(/\/+$/, "");
  return path.toLowerCase().endsWith("/v1")
    ? `${m[1]}${m[2]}${path}/usage`
    : `${m[1]}${m[2]}/v1/usage`;
}

/** Sub2API window 名 → 分类。 */
function classifyRelayWindow(name: string): string {
  const n = name.trim().toLowerCase();
  if (/five|5h|5[-_ ]?hour/.test(n)) return "five_hour";
  if (/week|seven|7d|7[-_ ]?day/.test(n)) return "weekly_limit";
  if (n.includes("month")) return "monthly";
  if (/day|daily|1d/.test(n)) return "daily";
  return n || "window";
}

const RELAY_WINDOW_LABEL: Record<string, string> = {
  five_hour: "5小时",
  daily: "1天",
  weekly_limit: "7天",
  monthly: "30天",
};

function parseRelayWindowObject(item: Record<string, unknown>): QuotaWindow | null {
  const name =
    (item.name ?? item.id ?? item.window ?? item.type ?? item.label) as string | undefined;
  const id = classifyRelayWindow(name ?? "");
  const pct =
    asNum(item.used_percent) ??
    asNum(item.usedPercent) ??
    asNum(item.percentage) ??
    (() => {
      const used = asNum(item.used) ?? asNum(item.usage);
      const limit = asNum(item.limit) ?? asNum(item.quota) ?? asNum(item.total);
      return used !== undefined && limit !== undefined && limit > 0
        ? (used / limit) * 100
        : undefined;
    })() ??
    (() => {
      const remainPct = asNum(item.remaining_percent) ?? asNum(item.remainingPercent);
      return remainPct !== undefined ? 100 - remainPct : undefined;
    })() ??
    (() => {
      const remaining = asNum(item.remaining);
      const limit = asNum(item.limit) ?? asNum(item.quota);
      return remaining !== undefined && limit !== undefined && limit > 0
        ? (Math.max(0, limit - remaining) / limit) * 100
        : undefined;
    })();
  if (pct === undefined) return null;
  const resetsAt = extractResetTime(
    item.reset_at ?? item.resets_at ?? item.resetsAt ?? item.resetTime ?? item.reset_time ?? item.end_time,
  );
  return window(RELAY_WINDOW_LABEL[id] ?? name ?? "窗口", pct, resetsAt);
}

async function fetchSub2api(baseUrl: string, key: string): Promise<VendorQuota> {
  const body = (await httpJson({
    url: sub2apiUsageUrl(baseUrl),
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })) as Record<string, unknown>;

  const code = typeof body.code === "string" ? body.code : undefined;
  if (code && code !== "ok" && code !== "success" && body.balance === undefined) {
    const lower = code.toLowerCase();
    if (lower.includes("invalid") || lower.includes("unauthorized") || lower.includes("key")) {
      throw new Error("鉴权失败 (Sub2API)");
    }
    throw new Error(`Sub2API 响应格式不支持 (code=${code})`);
  }

  // 窗口
  const windows: QuotaWindow[] = [];
  const seen = new Set<string>();
  for (const k of ["rate_limits", "rateLimits", "windows", "limits"]) {
    const arr = body[k];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const w = parseRelayWindowObject(item as Record<string, unknown>);
        if (w && !seen.has(w.label)) {
          seen.add(w.label);
          windows.push(w);
        }
      }
    }
  }
  const sub = (body.subscription ?? body.subscription_usage) as
    | Record<string, unknown>
    | undefined;
  if (sub) {
    for (const [name, child] of [
      ["daily", sub.daily],
      ["weekly", sub.weekly],
      ["monthly", sub.monthly],
    ] as const) {
      if (child && typeof child === "object") {
        const obj = { name, ...(child as Record<string, unknown>) };
        const w = parseRelayWindowObject(obj);
        if (w && !seen.has(w.label)) {
          seen.add(w.label);
          windows.push(w);
        }
      }
    }
  }

  // 余额
  const balanceNum =
    asNum(body.balance) ??
    asNum(body.remaining) ??
    asNum((body.wallet as Record<string, unknown> | undefined)?.balance) ??
    asNum((body.wallet as Record<string, unknown> | undefined)?.remaining);
  const unit =
    (typeof body.unit === "string" && body.unit.trim()) ||
    (typeof body.currency === "string" && body.currency.trim()) ||
    "USD";
  const symbol = unit === "CNY" ? "¥" : unit === "USD" ? "$" : `${unit} `;

  const planName = (body.planName ?? body.plan_name) as string | undefined;

  if (windows.length === 0 && balanceNum === undefined) {
    throw new Error("Sub2API 响应无额度数据");
  }
  const quota: VendorQuota = { windows: windows.slice(0, 2) };
  if (balanceNum !== undefined) quota.balanceText = `${symbol}${twoDecimals(balanceNum)}`;
  if (planName?.trim()) quota.planLabel = planName.trim();
  return quota;
}

async function fetchNewApi(baseUrl: string, key: string): Promise<VendorQuota> {
  const body = (await httpJson({
    url: `${relayOrigin(baseUrl)}/api/user/self`,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  })) as Record<string, unknown>;

  if (body.success === false && body.data === undefined) throw new Error("鉴权失败 (New API)");
  const data = (
    body.data && typeof body.data === "object" ? body.data : body
  ) as Record<string, unknown>;

  // New API / One API 内部额度单位: 500_000 ≈ $1
  const quotaRaw = asNum(data.quota) ?? asNum(data.remain_quota) ?? asNum(data.remaining_quota);
  if (quotaRaw === undefined) throw new Error("New API 响应无额度数据");
  const quota: VendorQuota = {
    windows: [],
    balanceText: `$${twoDecimals(Math.max(0, quotaRaw / 500_000))}`,
  };
  const group = typeof data.group === "string" ? data.group.trim() : "";
  if (group) quota.planLabel = group;
  return quota;
}

/** 中转站探测:Sub2API 优先,失败(含鉴权失败,sk 可能只对一侧有效)回退 New API。 */
export async function fetchRelay(baseUrl: string, key: string): Promise<VendorQuota> {
  try {
    return await fetchSub2api(baseUrl, key);
  } catch (subErr) {
    try {
      return await fetchNewApi(baseUrl, key);
    } catch {
      throw subErr instanceof Error ? subErr : new Error(String(subErr));
    }
  }
}
