/**
 * claude CLI 额度 provider ── 凭据适配层。
 *
 * 凭据源(实证 ~/.claude):
 * - settings.json: env.ANTHROPIC_BASE_URL + env.ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY
 *   (自定义供应商/中转站模式,本机实证 kimi: https://api.kimi.com/coding/)
 * - .credentials.json: claudeAiOauth.accessToken(官方订阅 OAuth)
 *
 * 分级(与 cli-codex 同策略):
 * 1. 自定义 base_url + key → detectVendorByBaseUrl 检测供应商 → fetchVendorQuota HTTP
 * 2. 官方 OAuth 无 base_url → 显式报不支持(Anthropic 无公开套餐额度 HTTP 面,不猜接口)
 */

import { ipc } from "@kernel/ipc";
import { registerQuotaProvider, type QuotaSnapshot } from "@kernel/quota";
import {
  detectVendorByBaseUrl,
  fetchVendorQuota,
  VENDOR_TITLE,
} from "../cli-shared/quota/vendors";

interface ClaudeEnvCredentials {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * 最小 settings.json env 提取(纯函数,可测)。
 * ANTHROPIC_AUTH_TOKEN 优先于 ANTHROPIC_API_KEY(claude 语义:Bearer token 优先)。
 * 外部 JSON 不做 inline cast,逐层 in/typeof 收窄。
 */
export function parseClaudeSettingsEnv(raw: string): ClaudeEnvCredentials {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("env" in parsed)) return {};
  const env: unknown = parsed.env;
  if (!env || typeof env !== "object") return {};
  const map = env as Record<string, unknown>; // typeof 已收窄为 object,字段逐一守卫
  const read = (key: string): string | undefined => {
    const value = map[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return {
    baseUrl: read("ANTHROPIC_BASE_URL"),
    apiKey: read("ANTHROPIC_AUTH_TOKEN") ?? read("ANTHROPIC_API_KEY"),
  };
}

async function readClaudeCredentials(home: string): Promise<ClaudeEnvCredentials> {
  try {
    return parseClaudeSettingsEnv(
      await ipc.fsReadFile(`${home}/.claude/settings.json`),
    );
  } catch {
    return {};
  }
}

/** 官方订阅 OAuth 登录判定:.credentials.json 有 claudeAiOauth.accessToken。 */
async function hasOfficialOAuth(home: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(
      await ipc.fsReadFile(`${home}/.claude/.credentials.json`),
    );
    if (!parsed || typeof parsed !== "object" || !("claudeAiOauth" in parsed)) {
      return false;
    }
    const oauth: unknown = parsed.claudeAiOauth;
    if (!oauth || typeof oauth !== "object" || !("accessToken" in oauth)) {
      return false;
    }
    const token: unknown = oauth.accessToken;
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}

async function fetchClaudeQuota(): Promise<QuotaSnapshot> {
  const home = await ipc.configHomeDir();
  const cred = await readClaudeCredentials(home);

  // 1. 自定义 base_url + key → 供应商检测 → HTTP(kimi/zhipu/minimax/deepseek/中转站)
  if (cred.baseUrl && cred.apiKey) {
    const vendor = detectVendorByBaseUrl(cred.baseUrl);
    const quota = await fetchVendorQuota(vendor, { key: cred.apiKey }, cred.baseUrl);
    return {
      providerLabel: "claude",
      title: VENDOR_TITLE[vendor] ?? "Claude 账号额度",
      usedLabel: "已使用",
      windows: quota.windows,
      balanceText: quota.balanceText,
      planLabel: quota.planLabel,
    };
  }

  // 2. 官方登录 → Anthropic 无公开套餐额度 HTTP 面,显式报错(对齐 codex 官方 key 模式)
  if (await hasOfficialOAuth(home)) {
    throw new Error("Anthropic 官方订阅暂无公开额度 API,请在 claude /usage 查看");
  }
  throw new Error("未找到 claude 凭据 (~/.claude/settings.json env)");
}

export function registerClaudeQuotaProvider(): void {
  registerQuotaProvider({
    profileId: "claude",
    fetch: fetchClaudeQuota,
  });
}
