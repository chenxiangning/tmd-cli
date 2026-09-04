/**
 * 引擎凭据盘点 —— 每引擎列出"已登录/已配置"的供应商 + 尽力查询额度。
 *
 * 架构边界:
 * - 只用通用 IPC 原语(fsReadFile / ompAuthProviders / ompAuthCredential / configHomeDir),
 *   不依赖其它 cli-* 插件的实现(插件零直接依赖铁律);
 * - 额度查询走 cli-shared/quota/vendors 共享库(合法:它是无生命周期的格式库);
 * - 拿不到额度 ≠ 错误:显示"已登录/已配置",不猜接口(对齐 quota 体系既有原则);
 * - $ENV_VAR 引用不解析(welcome 是盘点视角,不是发送链路,显示已配置即可)。
 */

import { ipc } from "@kernel/ipc";
import type { QuotaWindow } from "@kernel/quota";
import {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  fetchVendorQuota,
  VENDOR_TITLE,
  type VendorCredential,
  type VendorId,
} from "../cli-shared/quota/vendors";
import {
  codexPlanLabelWithSnapshot,
  readCodexLocalQuota,
} from "../cli-shared/quota/codexLocal";
import { resolveGrokDefaultProfile } from "../cli-shared/grokConfig";

/** 单个已登录供应商的盘点结果。 */
export interface EngineCredential {
  /** 供应商 id(CLI 内 provider key,例 kimi-code / openai-codex)。 */
  providerId: string;
  /** 供应商标题(例 "KIMI 套餐额度");无法识别 vendor 时回退 providerId。 */
  title: string;
  /** 额度窗口;查不到 = 空表(显示"已登录"文本)。 */
  windows: QuotaWindow[];
  balanceText?: string;
  planLabel?: string;
  /** 查询失败的说明(展示为小字,不当致命错误)。 */
  note?: string;
}

/* ── 公共小工具 ─────────────────────────────────────────── */

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** 凭据 → VendorQuota → EngineCredential 的公共收口。 */
async function toCredential(
  providerId: string,
  vendor: VendorId,
  cred: VendorCredential,
  baseUrl?: string,
): Promise<EngineCredential> {
  const title = VENDOR_TITLE[vendor] ?? providerId;
  try {
    const quota = await fetchVendorQuota(vendor, cred, baseUrl);
    return {
      providerId,
      title,
      windows: quota.windows,
      balanceText: quota.balanceText,
      planLabel: quota.planLabel,
    };
  } catch (err) {
    return {
      providerId,
      title,
      windows: [],
      note: err instanceof Error ? err.message : String(err),
    };
  }
}
/* ── omp(agent.db provider 列表 + 凭据数据) ──────────────── */

/** JSON.parse 容错:磁盘文件可能截断/损坏,裸抛会让整个凭据区静默消失
 *  (调用方 CredentialList 无 catch,还附带 unhandled rejection)。 */
function parseJsonLoose(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asObj(JSON.parse(raw));
  } catch {
    return null;
  }
}


function parseCredentialData(raw: string): VendorCredential {
  const parsed = parseJsonLoose(raw);
  if (!parsed) return {};
  return {
    key: asStr(parsed.key),
    access: asStr(parsed.access),
    accountId: asStr(parsed.accountId),
  };
}

async function listOmpCredentials(): Promise<EngineCredential[]> {
  const providers = await ipc.ompAuthProviders().catch(() => [] as string[]);
  const out: EngineCredential[] = [];
  for (const providerId of providers) {
    const vendor = detectVendorByProviderId(providerId);
    if (!vendor) {
      out.push({ providerId, title: providerId, windows: [], note: "暂不支持该供应商" });
      continue;
    }
    if (vendor === "openai-codex") {
      /* 官方 OAuth → 本地 rollout 快照(零 HTTP,同 cli-omp quota 策略)。 */
      try {
        const local = await readCodexLocalQuota();
        out.push({
          providerId,
          title: VENDOR_TITLE["openai-codex"],
          windows: local.windows,
          planLabel: codexPlanLabelWithSnapshot(local),
        });
      } catch {
        out.push({ providerId, title: VENDOR_TITLE["openai-codex"], windows: [], note: "已登录" });
      }
      continue;
    }
    const raw = await ipc.ompAuthCredential(providerId).catch(() => null);
    if (!raw) {
      out.push({ providerId, title: VENDOR_TITLE[vendor], windows: [], note: "凭据缺失" });
      continue;
    }
    out.push(await toCredential(providerId, vendor, parseCredentialData(raw)));
  }
  return out;
}

/* ── pi(auth.json provider keys) ───────────────────────── */

async function listPiCredentials(): Promise<EngineCredential[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const raw = await ipc.fsReadFile(`${home}/.pi/agent/auth.json`).catch(() => null);
  if (!raw) return [];
  const auth = parseJsonLoose(raw);
  if (!auth) return [];
  const out: EngineCredential[] = [];
  for (const [providerId, entryRaw] of Object.entries(auth)) {
    const vendor = detectVendorByProviderId(providerId);
    if (!vendor) continue;
    const entry = asObj(entryRaw);
    const key = asStr(entry?.apiKey) ?? asStr(entry?.key);
    out.push(await toCredential(providerId, vendor, { key }));
  }
  return out;
}

/* ── codex(auth.json OAuth → 本地快照) ─────────────────── */

async function listCodexCredentials(): Promise<EngineCredential[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const raw = await ipc.fsReadFile(`${home}/.codex/auth.json`).catch(() => null);
  if (!raw) return [];
  const auth = parseJsonLoose(raw);
  const tokens = asObj(auth?.tokens);
  if (!asStr(tokens?.access_token)) return [];
  try {
    const local = await readCodexLocalQuota();
    return [
      {
        providerId: "openai-codex",
        title: VENDOR_TITLE["openai-codex"],
        windows: local.windows,
        planLabel: codexPlanLabelWithSnapshot(local),
      },
    ];
  } catch {
    return [
      {
        providerId: "openai-codex",
        title: VENDOR_TITLE["openai-codex"],
        windows: [],
        note: "已登录(ChatGPT 订阅)",
      },
    ];
  }
}

/* ── claude(settings.json env → vendor 检测) ───────────── */

async function listClaudeCredentials(): Promise<EngineCredential[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const raw = await ipc.fsReadFile(`${home}/.claude/settings.json`).catch(() => null);
  const env = asObj(parseJsonLoose(raw)?.env);
  const baseUrl = asStr(env?.ANTHROPIC_BASE_URL);
  const key = asStr(env?.ANTHROPIC_AUTH_TOKEN) ?? asStr(env?.ANTHROPIC_API_KEY);
  if (baseUrl && key) {
    const vendor = detectVendorByBaseUrl(baseUrl);
    return [
      await toCredential("anthropic-custom", vendor, { key }, baseUrl),
    ];
  }
  /* 官方订阅 OAuth:无公开额度 API,显式报"已登录",不猜接口。 */
  const cred = await ipc
    .fsReadFile(`${home}/.claude/.credentials.json`)
    .catch(() => null);
  const oauth = asObj(parseJsonLoose(cred)?.claudeAiOauth);
  if (asStr(oauth?.accessToken)) {
    return [
      {
        providerId: "anthropic",
        title: "Claude 官方订阅",
        windows: [],
        note: "已登录;官方订阅额度请在 CLI 内 /usage 查看",
      },
    ];
  }
  return [];
}


/* ── grok(config.toml 默认档案 → vendor 检测) ──────────── */

async function listGrokCredentials(): Promise<EngineCredential[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const raw = await ipc.fsReadFile(`${home}/.grok/config.toml`).catch(() => null);
  if (!raw) return [];
  const profile = resolveGrokDefaultProfile(raw);
  if (profile.baseUrl && profile.apiKey) {
    const vendor = detectVendorByBaseUrl(profile.baseUrl);
    return [
      await toCredential(`grok/${profile.id}`, vendor, { key: profile.apiKey }, profile.baseUrl),
    ];
  }
  /* grok login(OAuth)凭据不落 config.toml,磁盘无可证伪的登录态,不猜 → 空表。 */
  return [];
}

/* ── 统一入口 ─────────────────────────────────────────── */

export async function listEngineCredentials(
  engineId: string,
): Promise<EngineCredential[]> {
  switch (engineId) {
    case "omp":
      return listOmpCredentials();
    case "pi":
      return listPiCredentials();
    case "codex":
      return listCodexCredentials();
    case "claude":
      return listClaudeCredentials();
    case "grok":
      return listGrokCredentials();
    default:
      return [];
  }
}
