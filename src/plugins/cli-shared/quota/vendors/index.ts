/**
 * 供应商额度 HTTP 适配层 ── 共同能力,全部 CLI 插件 + welcome 凭据盘共享
 * (welcome/credentials*.ts 联合消费,先例依 1 cli-* + feature 联合准入)。
 *
 * 契约对齐 codemoss src-tauri/src/coding_plan_quota/(providers.rs / relay.rs / pi_usage.rs):
 * - kimi:        GET https://api.kimi.com/coding/v1/usages        (Bearer)
 * - minimax:     GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains (cn)
 *                GET https://api.minimax.io/...                   (en)  (Bearer)
 * - zhipu:       GET {open.bigmodel.cn|api.z.ai}/api/monitor/usage/quota/limit (裸 Authorization, 无 Bearer)
 * - deepseek:    GET https://api.deepseek.com/user/balance        (Bearer, 余额型无窗口)
 * - relay:       未知中转站 → Sub2API GET {origin}[/v1]/usage → 失败回退 New API GET {origin}/api/user/self
 * - openai-codex:官方 OAuth 登录优先走 codexLocal.ts 本地 rollout 快照(wham 有封号风险);
 *                快照不可用或自定义 key 模式降级走 codex.ts wham/relay HTTP。
 *
 * 各 CLI 插件只负责「取凭据」:pi 读 auth.json+models.json / omp 读 agent.db / codex 读 auth.json+config.toml,
 * 拿到 { key | access+accountId } 后统一走 fetchVendorQuota。
 *
 * 目录结构:types(类型) / http(内部小工具) / detect(供应商识别) /
 * fetchers(kimi/minimax/zhipu/deepseek) / codex(wham 降级) / relay(中转站)。
 */

import { t } from "@kernel/i18n";
import type { QuotaSnapshot } from "@kernel/quota";

import { fetchOpenaiCodex } from "./codex";
import { fetchDeepseek, fetchKimi, fetchMinimax, fetchZhipu } from "./fetchers";
import { fetchRelay } from "./relay";
import { VENDOR_TITLE, type VendorCredential, type VendorId, type VendorQuota } from "./types";

/* ── barrel:公共 API 面与原 vendors.ts 完全一致 ─────────── */

export {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  vendorFromModel,
} from "./detect";
export {
  VENDOR_TITLE,
  type VendorCredential,
  type VendorId,
  type VendorQuota,
} from "./types";

/** vendor 查询结果 → 额度卡片快照(全部 CLI 插件同一塑形口径)。 */
export function toQuotaSnapshot(
  providerLabel: string,
  vendor: VendorId,
  quota: VendorQuota,
  fallbackTitle?: string,
): QuotaSnapshot {
  return {
    providerLabel,
    title: VENDOR_TITLE[vendor] ?? fallbackTitle ?? `${providerLabel} 额度`,
    usedLabel: "已使用",
    windows: quota.windows,
    balanceText: quota.balanceText,
    balanceValue: quota.balanceValue,
    planLabel: quota.planLabel,
  };
}

/* ── 统一入口 ─────────────────────────────────────────── */

/**
 * 供应商快照共享缓存(welcome 凭据盘 / notify 轮询 / composer QuotaChip 同吃
 * 一份,0.4.2 批二):同一 (vendor, 凭据, baseUrl) 60s 内只打一次供应商 HTTP,
 * 三家消费面各自触发不再重复抓同一窗口。只缓存成功;失败不缓存(各家退避
 * 重试语义不受影响)。凭据以 JSON 串作键(进程内存,防 32 位散列跨凭据误 hit)。
 */
const SNAP_TTL_MS = 60_000;
/* 非硬顶:极端量新键可短暂超容,插入期过期清扫自愈(现实凭据规模远不及)。 */
const SNAP_CACHE_CAP = 96;
const snapCache = new Map<string, { at: number; quota: VendorQuota }>();
const snapInflight = new Map<string, Promise<VendorQuota>>();

/** 仅供测试:清空快照缓存与在飞表(先例 rollup.resetMonthCache)。 */
export function resetQuotaSnapCache(): void {
  snapCache.clear();
  snapInflight.clear();
}

/**
 * 按供应商查额度(带共享快照缓存)。cred 需带对应字段:
 * - key 型: kimi / minimax / zhipu / deepseek / relay 用 cred.key(或 access)
 * baseUrl 仅 relay 需要(未知中转站)。
 * openai-codex 不在此列:统一走 codexLocal.ts 本地 rollout 快照,零 HTTP。
 */
export async function fetchVendorQuota(
  vendor: VendorId,
  cred: VendorCredential,
  baseUrl?: string,
  opts?: { force?: boolean },
): Promise<VendorQuota> {
  const key = `${vendor}|${baseUrl ?? ""}|${JSON.stringify(cred)}`;
  const now = Date.now();
  /* force = 手动强刷(QuotaChip ⟳ 经 provider 透传):跳过缓存读与在飞合并,照常回写。 */
  if (!opts?.force) {
    const hit = snapCache.get(key);
    if (hit && now - hit.at < SNAP_TTL_MS) return hit.quota;
    const running = snapInflight.get(key);
    if (running) return running;
  }
  const p = fetchVendorQuotaFresh(vendor, cred, baseUrl)
    .then((quota) => {
      if (snapCache.size >= SNAP_CACHE_CAP) {
        for (const [k, v] of snapCache) if (Date.now() - v.at >= SNAP_TTL_MS) snapCache.delete(k);
      }
      snapCache.set(key, { at: Date.now(), quota });
      snapInflight.delete(key);
      return quota;
    })
    .catch((e) => {
      snapInflight.delete(key);
      throw e;
    });
  snapInflight.set(key, p);
  return p;
}

/** 真抓取(缓存未命中路径;keep 原签名语义)。 */
async function fetchVendorQuotaFresh(
  vendor: VendorId,
  cred: VendorCredential,
  baseUrl?: string,
): Promise<VendorQuota> {
  const keyOrAccess = cred.key ?? cred.access;
  switch (vendor) {
    case "kimi":
      if (!keyOrAccess) throw new Error(t("缺少 kimi 凭据"));
      return fetchKimi(keyOrAccess);
    case "minimax-cn":
    case "minimax-en":
      if (!keyOrAccess) throw new Error(t("缺少 minimax API key"));
      return fetchMinimax(keyOrAccess, vendor === "minimax-cn");
    case "zhipu-cn":
    case "zhipu-en":
      if (!keyOrAccess) throw new Error(t("缺少智谱 API key"));
      return fetchZhipu(keyOrAccess, vendor === "zhipu-cn");
    case "deepseek":
      if (!keyOrAccess) throw new Error(t("缺少 deepseek API key"));
      return fetchDeepseek(keyOrAccess);
    case "openai-codex":
      // 降级路径:仅当官方 OAuth 登录的本地快照不可用,或调用方无快照来源时使用。
      if (!cred.access || !cred.accountId) {
        throw new Error(t("缺少 openai-codex oauth 凭据 (access/accountId)"));
      }
      return fetchOpenaiCodex(cred.access, cred.accountId);
    case "relay":
      if (!keyOrAccess) throw new Error(t("缺少中转站 API key"));
      if (!baseUrl) throw new Error(t("中转站查询需要 base_url"));
      return fetchRelay(baseUrl, keyOrAccess);
    case "unsupported":
      throw new Error(t("该供应商(阿里云百炼 Coding Plan)无公开额度 API,请在控制台查看"));
  }
}
