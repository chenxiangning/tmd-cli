/**
 * omp CLI 额度 provider ── 凭据适配层。
 *
 * 凭据源(实证 ~/.omp/agent/agent.db):
 * - auth_credentials 表: provider / credential_type(api_key|oauth) / data JSON
 *   data 形状: api_key 型 {"key": "sk-..."} / oauth 型 {"access": "...", "accountId": "..."}
 *   本机实证 providers: kimi-code / minimax-code-cn / openai-codex
 * - sqlite 由 Rust omp_auth_credential 只读取出,JS 不直接碰库。
 *
 * 路由: 当前模型 "vendor/model" 前缀 → detectVendorByProviderId;
 * omp provider id 即官方供应商(kimi-code→kimi 等),无需 base_url 推导;
 * 未识别的 vendor 显式报不支持(不猜)。
 *
 * codex 供应商分级(与 cli-codex/cli-pi 同策略):
 * OAuth 凭据 → 本地 rollout 快照(零 HTTP),快照不可用降级 wham HTTP;非 OAuth → 直接 HTTP。
 */

import { ipc } from "@kernel/ipc";
import {
  registerQuotaProvider,
  type QuotaFetchContext,
  type QuotaSnapshot,
} from "@kernel/quota";
import {
  codexPlanLabelWithSnapshot,
  readCodexLocalQuota,
} from "../cli-shared/quota/codexLocal";
import {
  detectVendorByProviderId,
  fetchVendorQuota,
  VENDOR_TITLE,
  vendorFromModel,
  type VendorCredential,
  type VendorId,
} from "../cli-shared/quota/vendors";

/** agent.db data JSON 边界解析:object + 字段 typeof 守卫,不信手断言。 */
function parseCredentialData(raw: string): VendorCredential {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return {};
  const map = parsed as Record<string, unknown>; // typeof 已收窄为 object,字段逐一守卫
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { key: str(map.key), access: str(map.access), accountId: str(map.accountId) };
}

function toSnapshot(providerId: string, vendor: VendorId, quota: {
  windows: QuotaSnapshot["windows"];
  balanceText?: string;
  planLabel?: string;
}): QuotaSnapshot {
  return {
    providerLabel: providerId,
    title: VENDOR_TITLE[vendor] ?? `${providerId} 额度`,
    usedLabel: "已使用",
    windows: quota.windows,
    balanceText: quota.balanceText,
    planLabel: quota.planLabel,
  };
}

async function fetchOmpQuota(ctx: QuotaFetchContext): Promise<QuotaSnapshot> {
  const ompVendor = vendorFromModel(ctx.model);
  if (!ompVendor) {
    throw new Error("未识别当前模型,无法路由供应商");
  }
  const vendor = detectVendorByProviderId(ompVendor);
  if (!vendor) {
    throw new Error(`omp 供应商 ${ompVendor} 暂不支持额度查询`);
  }

  const raw = await ipc.ompAuthCredential(ompVendor);
  const cred: VendorCredential = raw ? parseCredentialData(raw) : {};

  // codex 供应商:OAuth → 本地快照优先,降级 wham;非 OAuth/未登录 → wham 显式报错
  if (vendor === "openai-codex") {
    if (cred.access && cred.accountId) {
      try {
        const local = await readCodexLocalQuota();
        return {
          providerLabel: ompVendor,
          title: VENDOR_TITLE["openai-codex"],
          usedLabel: "已使用",
          windows: local.windows,
          planLabel: codexPlanLabelWithSnapshot(local),
        };
      } catch {
        // 本地无快照 → 降级 wham HTTP
      }
    }
    const quota = await fetchVendorQuota("openai-codex", cred);
    return toSnapshot(ompVendor, vendor, quota);
  }

  if (!raw) {
    throw new Error(`omp 未登录供应商 ${ompVendor} (~/.omp/agent/agent.db)`);
  }
  const quota = await fetchVendorQuota(vendor, cred);
  return toSnapshot(ompVendor, vendor, quota);
}

export function registerOmpQuotaProvider(): void {
  registerQuotaProvider({
    profileId: "omp",
    fetch: fetchOmpQuota,
  });
}
