/**
 * codex CLI 额度 provider ── 分级策略。
 *
 * 凭据源(实证 ~/.codex):
 * - auth.json: { tokens?: { access_token, account_id }, OPENAI_API_KEY? }
 * - config.toml: model_provider + [model_providers.<x>].base_url(自定义 key/中转站)
 *
 * 分级(用户决策):
 * 1. 官方登录(ChatGPT OAuth, tokens 有 access+account_id)
 *    → CLI 本地 rollout 快照(codexLocal.ts,零 HTTP,防 wham 封号)
 *    → 快照不可用降级 wham HTTP
 * 2. 自定义 key 模式(OPENAI_API_KEY + config.toml base_url)
 *    → HTTP: base_url 检测供应商(minimax/deepseek/relay...)走 vendors.ts
 * 3. 官方 API key 无 base_url → 显式报不支持(OpenAI 无套餐额度 HTTP 面)
 */

import { ipc } from "@kernel/ipc";
import {
  registerQuotaProvider,
  type QuotaSnapshot,
} from "@kernel/quota";
import {
  codexPlanLabelWithSnapshot,
  readCodexLocalQuota,
  type CodexLocalQuota,
} from "../cli-shared/quota/codexLocal";
import {
  detectVendorByBaseUrl,
  fetchVendorQuota,
  type VendorQuota,
} from "../cli-shared/quota/vendors";

interface CodexAuth {
  tokens?: { access_token?: string; account_id?: string };
  OPENAI_API_KEY?: string;
}

/**
 * 最小 config.toml 提取(纯函数,可测):顶层 model_provider 与对应
 * [model_providers.<name>] 段的 base_url。不引入 TOML 解析器。
 */
export function parseCodexConfigToml(raw: string): { provider?: string; baseUrl?: string } {
  let provider: string | undefined;
  let section: string | null = null;
  let baseUrl: string | undefined;
  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  for (const line of raw.split("\n")) {
    const text = line.replace(/#.*$/, "").trim();
    if (!text) continue;
    const sectionMatch = /^\[([\w."-]+)\]$/.exec(text);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(text);
    if (!kv) continue;
    if (section === null && kv[1] === "model_provider") {
      provider = unquote(kv[2]);
      continue;
    }
    if (provider && section && kv[1] === "base_url") {
      // [model_providers.<provider>] 或 [model_providers."<provider>"]
      const want = `model_providers.${provider}`;
      if (section === want || section === `model_providers."${provider}"`) {
        baseUrl = unquote(kv[2]);
      }
    }
  }
  return { provider, baseUrl };
}

async function readCodexAuth(home: string): Promise<CodexAuth | null> {
  try {
    const parsed: unknown = JSON.parse(await ipc.fsReadFile(`${home}/.codex/auth.json`));
    if (!parsed || typeof parsed !== "object") return null;
    const auth = parsed as CodexAuth; // 字段消费点均有可选链 + typeof 守卫
    return auth;
  } catch {
    return null;
  }
}

function chatGptOAuth(auth: CodexAuth | null): { access: string; accountId: string } | null {
  const access = auth?.tokens?.access_token;
  const accountId = auth?.tokens?.account_id;
  return typeof access === "string" && access && typeof accountId === "string" && accountId
    ? { access, accountId }
    : null;
}

function localSnapshot(quota: CodexLocalQuota): QuotaSnapshot {
  return {
    providerLabel: "codex",
    title: "Codex 账号额度",
    usedLabel: "已使用",
    windows: quota.windows,
    planLabel: codexPlanLabelWithSnapshot(quota),
  };
}

function httpSnapshot(quota: VendorQuota, planPrefix?: string): QuotaSnapshot {
  return {
    providerLabel: "codex",
    title: "Codex 账号额度",
    usedLabel: "已使用",
    windows: quota.windows,
    balanceText: quota.balanceText,
    planLabel: [planPrefix, quota.planLabel].filter(Boolean).join(" · ") || undefined,
  };
}

async function fetchCodexQuota(): Promise<QuotaSnapshot> {
  const home = await ipc.configHomeDir();
  const auth = await readCodexAuth(home);

  // 1. 官方 OAuth 登录 → CLI 本地快照;失败降级 wham HTTP
  const oauth = chatGptOAuth(auth);
  if (oauth) {
    try {
      return localSnapshot(await readCodexLocalQuota());
    } catch {
      const quota = await fetchVendorQuota("openai-codex", oauth);
      return httpSnapshot(quota);
    }
  }

  // 2. 自定义 key 模式 → config.toml base_url 检测供应商 → HTTP
  const key = typeof auth?.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : undefined;
  if (key) {
    let baseUrl: string | undefined;
    try {
      const toml = await ipc.fsReadFile(`${home}/.codex/config.toml`);
      baseUrl = parseCodexConfigToml(toml).baseUrl;
    } catch {
      // config.toml 缺失 → 视为官方 key
    }
    if (baseUrl) {
      const vendor = detectVendorByBaseUrl(baseUrl);
      if (vendor !== "unsupported") {
        const quota = await fetchVendorQuota(vendor, { key }, baseUrl);
        return httpSnapshot(quota, "自定义 key");
      }
      throw new Error("codex 自定义供应商(阿里云百炼)无公开额度 API,请在控制台查看");
    }
    throw new Error("codex 为官方 API key 模式,OpenAI 无套餐额度查询接口");
  }

  throw new Error("未找到 codex 登录态 (~/.codex/auth.json)");
}

export function registerCodexQuotaProvider(): void {
  registerQuotaProvider({
    profileId: "codex",
    fetch: fetchCodexQuota,
  });
}
