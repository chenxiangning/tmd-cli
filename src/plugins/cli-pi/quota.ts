/**
 * pi CLI 额度 provider ── 凭据适配层。
 *
 * 凭据源与路由规则见 piLocalConfig.ts / piRoute.ts(文件规模铁则拆出)。
 *
 * 兼容凭据引用: `$ENV_VAR` 从环境变量取值;`!command` 不执行 shell,显式报不支持。
 * HTTP 调用全部走 cli-shared/quota/vendors.ts 共同能力。
 */

import { ipc } from "@kernel/ipc";
import type { QuotaFetchContext, QuotaSnapshot } from "@kernel/quota";
import { fetchCodexQuotaWithSnapshot } from "../cli-shared/quota/codexLocal";
import {
  fetchVendorQuota,
  toQuotaSnapshot,
  type VendorCredential,
} from "../cli-shared/quota/vendors";
import { readPiLocalConfig } from "./piLocalConfig";
import { resolvePiRoute } from "./piRoute";

/* ── 凭据引用解析($ENV_VAR)────────────────────────────── */

async function resolveCredentialRef(
  value: string | undefined,
  field: string,
): Promise<string | undefined> {
  const text = value?.trim() ?? "";
  if (!text) return undefined;
  if (text.startsWith("!")) {
    throw new Error(`pi 凭据 ${field} 使用命令引用(!command),tmd-cli 不执行 shell;请改为 $ENV_VAR 或纯值`);
  }
  if (text.startsWith("$")) {
    const envName = text.slice(1).trim();
    const envValue = envName ? await ipc.quotaEnvValue(envName) : null;
    if (!envValue) {
      throw new Error(`pi 凭据 ${field} 引用的环境变量 ${envName || text} 未设置`);
    }
    return envValue;
  }
  return text;
}

export async function resolveCredentialRefs(
  providerId: string,
  cred: VendorCredential,
): Promise<VendorCredential> {
  return {
    key: await resolveCredentialRef(cred.key, `${providerId}.key`),
    access: await resolveCredentialRef(cred.access, `${providerId}.access`),
    accountId: await resolveCredentialRef(cred.accountId, `${providerId}.accountId`),
  };
}

/* ── 入口 ─────────────────────────────────────────────── */

export async function fetchPiQuota(ctx: QuotaFetchContext): Promise<QuotaSnapshot> {
  const config = await readPiLocalConfig();
  const route = resolvePiRoute(config, ctx.model);
  // codex 供应商分级(与 cli-codex 同策略):官方 OAuth 登录走 CLI 本地快照,
  // 快照不可用降级 wham HTTP;非 OAuth 凭据直接走 HTTP。
  if (route.vendor === "openai-codex") {
    const cred = await resolveCredentialRefs(route.providerId, route.credential);
    return fetchCodexQuotaWithSnapshot(cred, route.providerId);
  }
  const cred = await resolveCredentialRefs(route.providerId, route.credential);
  const quota = await fetchVendorQuota(route.vendor, cred, route.baseUrl);
  return toQuotaSnapshot(route.providerId, route.vendor, quota);
}
