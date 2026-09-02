/**
 * grok CLI 额度 provider ── 凭据适配层。
 *
 * 凭据源(实证 ~/.grok/config.toml,grok 1.0.4):
 * - [model."<id>"] 的 base_url + api_key(自定义供应商/中转站模式,
 *   本机实证 fufei.mossx.ai → relay 通道)
 * - 官方 OAuth(grok login)凭据不落 config.toml,无 key 可取
 *
 * 分级(与 cli-claude 同策略):
 * 1. 默认档案有 base_url + api_key → detectVendorByBaseUrl → fetchVendorQuota HTTP
 * 2. 无 key → 显式报不支持/未配置,不猜接口
 */

import { ipc } from "@kernel/ipc";
import { registerQuotaProvider, type QuotaSnapshot } from "@kernel/quota";
import {
  detectVendorByBaseUrl,
  fetchVendorQuota,
  VENDOR_TITLE,
} from "../cli-shared/quota/vendors";
import { resolveGrokDefaultProfile } from "../cli-shared/grokConfig";

async function fetchGrokQuota(): Promise<QuotaSnapshot> {
  const home = await ipc.configHomeDir();
  const text = await ipc.fsReadFile(`${home}/.grok/config.toml`);
  const profile = resolveGrokDefaultProfile(text);

  if (profile.baseUrl && profile.apiKey) {
    const vendor = detectVendorByBaseUrl(profile.baseUrl);
    const quota = await fetchVendorQuota(vendor, { key: profile.apiKey }, profile.baseUrl);
    return {
      providerLabel: "grok",
      title: VENDOR_TITLE[vendor] ?? "Grok 账号额度",
      usedLabel: "已使用",
      windows: quota.windows,
      balanceText: quota.balanceText,
      planLabel: quota.planLabel,
    };
  }

  throw new Error(
    "未找到 grok 凭据 (~/.grok/config.toml [model] api_key);官方 OAuth 登录暂无公开额度 API,请在 CLI 内查看",
  );
}

export function registerGrokQuotaProvider(): void {
  registerQuotaProvider({
    profileId: "grok",
    fetch: fetchGrokQuota,
  });
}
