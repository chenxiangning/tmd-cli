/**
 * 供应商额度 HTTP 适配层 ── 共同能力,全部 CLI 插件共享。
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

import { fetchOpenaiCodex } from "./codex";
import { fetchDeepseek, fetchKimi, fetchMinimax, fetchZhipu } from "./fetchers";
import { fetchRelay } from "./relay";
import type { VendorCredential, VendorId, VendorQuota } from "./types";

/* ── barrel:公共 API 面与原 vendors.ts 完全一致 ─────────── */

export { aggregateCodexUsage } from "./codex";
export {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  vendorFromModel,
} from "./detect";
export { parseZhipuLimit } from "./fetchers";
export {
  VENDOR_TITLE,
  type VendorCredential,
  type VendorId,
  type VendorQuota,
} from "./types";

/* ── 统一入口 ─────────────────────────────────────────── */

/**
 * 按供应商查额度。cred 需带对应字段:
 * - key 型: kimi / minimax / zhipu / deepseek / relay 用 cred.key(或 access)
 * baseUrl 仅 relay 需要(未知中转站)。
 * openai-codex 不在此列:统一走 codexLocal.ts 本地 rollout 快照,零 HTTP。
 */
export async function fetchVendorQuota(
  vendor: VendorId,
  cred: VendorCredential,
  baseUrl?: string,
): Promise<VendorQuota> {
  const keyOrAccess = cred.key ?? cred.access;
  switch (vendor) {
    case "kimi":
      if (!keyOrAccess) throw new Error("缺少 kimi 凭据");
      return fetchKimi(keyOrAccess);
    case "minimax-cn":
    case "minimax-en":
      if (!keyOrAccess) throw new Error("缺少 minimax API key");
      return fetchMinimax(keyOrAccess, vendor === "minimax-cn");
    case "zhipu-cn":
    case "zhipu-en":
      if (!keyOrAccess) throw new Error("缺少智谱 API key");
      return fetchZhipu(keyOrAccess, vendor === "zhipu-cn");
    case "deepseek":
      if (!keyOrAccess) throw new Error("缺少 deepseek API key");
      return fetchDeepseek(keyOrAccess);
    case "openai-codex":
      // 降级路径:仅当官方 OAuth 登录的本地快照不可用,或调用方无快照来源时使用。
      if (!cred.access || !cred.accountId) {
        throw new Error("缺少 openai-codex oauth 凭据 (access/accountId)");
      }
      return fetchOpenaiCodex(cred.access, cred.accountId);
    case "relay":
      if (!keyOrAccess) throw new Error("缺少中转站 API key");
      if (!baseUrl) throw new Error("中转站查询需要 base_url");
      return fetchRelay(baseUrl, keyOrAccess);
    case "unsupported":
      throw new Error("该供应商(阿里云百炼 Coding Plan)无公开额度 API,请在控制台查看");
  }
}
