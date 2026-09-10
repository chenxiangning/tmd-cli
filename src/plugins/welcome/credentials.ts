/**
 * 引擎凭据盘点 —— 每引擎列出"已登录/已配置"的供应商 + 尽力查询额度。
 *
 * - 只用通用 IPC 原语(fsReadFile / sqliteQuery / configHomeDir)+ cli-shared
 *   共享格式库,不依赖其它 cli-* 插件实现(插件零直接依赖铁律);
 *
 * - 拿不到额度 ≠ 错误:显示"已登录/已配置",不猜接口(对齐 quota 体系既有原则);
 * - $ENV_VAR 引用不解析(welcome 是盘点视角,不是发送链路,显示已配置即可)。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { QuotaWindow } from "@kernel/quota";
import {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  fetchVendorQuota,
  VENDOR_TITLE,
  type VendorCredential,
  type VendorId,
} from "../cli-shared/quota/vendors";
/* 经 cli-shared 消费 codex 本地额度快照格式(合法通道,见文件头架构边界)。 */
import {
  codexPlanLabelWithSnapshot,
  readCodexLocalQuota,
} from "../cli-shared/quota/codexLocal";
/* 经 cli-shared 消费 grok config.toml 默认档格式(合法通道,同上)。 */
import { resolveGrokDefaultProfile } from "../cli-shared/grokConfig";
/* 同上:omp 凭据库(agent.db)格式知识经 cli-shared 消费。 */
import {
  listOmpAuthProviders,
  readOmpAuthCredential,
} from "../cli-shared/quota/ompAuth";
/* 同上:opencode auth.json 供应商表格式知识经 cli-shared 消费。 */
import { listOpencodeAuthEntries } from "../cli-shared/opencodeDisk";
/* JSON 容错 + 凭据投影见 credentialParse.ts(自本文件拆出,文件规模铁则)。 */
import { parseJsonLoose, parseCredentialData } from "./credentialParse";

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

async function listOmpCredentials(): Promise<EngineCredential[]> {
  const providers = await listOmpAuthProviders();
  const out: EngineCredential[] = [];
  /* 逐个顺序探测(reduce Promise 链保序):凭据/额度读取不并发打满。 */
  await providers.reduce<Promise<void>>(
    (chain, providerId) =>
      chain.then(async () => {
        const vendor = detectVendorByProviderId(providerId);
        if (!vendor) {
          out.push({ providerId, title: providerId, windows: [], note: t("暂不支持该供应商") });
          return;
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
            out.push({ providerId, title: VENDOR_TITLE["openai-codex"], windows: [], note: t("已登录") });
          }
          return;
        }
        const raw = await readOmpAuthCredential(providerId);
        if (!raw) {
          out.push({ providerId, title: VENDOR_TITLE[vendor], windows: [], note: t("凭据缺失") });
          return;
        }
        out.push(await toCredential(providerId, vendor, parseCredentialData(raw)));
      }),
    Promise.resolve(),
  );
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
  /* 逐个顺序探测(reduce Promise 链保序,同 listOmpCredentials)。 */
  await Object.entries(auth).reduce<Promise<void>>(
    (chain, [providerId, entryRaw]) =>
      chain.then(async () => {
        const vendor = detectVendorByProviderId(providerId);
        if (!vendor) return;
        /* asObj 语义内联:非对象条目一律视为无凭据;key 必须 trim 后非空串
           (原 asStr 的 typeof 收窄,勿用 as 断言——放过非字符串会带病下探)。 */
        const entry = entryRaw && typeof entryRaw === "object" ? (entryRaw as Record<string, unknown>) : null;
        const rawKey = entry?.apiKey ?? entry?.key;
        const key = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : undefined;
        out.push(await toCredential(providerId, vendor, { key }));
      }),
    Promise.resolve(),
  );
  return out;
}

/* ── codex(auth.json OAuth → 本地快照) ─────────────────── */

async function listCodexCredentials(): Promise<EngineCredential[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const raw = await ipc.fsReadFile(`${home}/.codex/auth.json`).catch(() => null);
  if (!raw) return [];
  const auth = parseJsonLoose(raw);
  const tokens = (auth?.tokens as Record<string, unknown> | undefined) ?? null;
  if (!(typeof tokens?.access_token === "string" && tokens.access_token.trim())) return [];
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
        note: t("已登录(ChatGPT 订阅)"),
      },
    ];
  }
}

/* ── claude(settings.json env → vendor 检测) ───────────── */

async function listClaudeCredentials(): Promise<EngineCredential[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const raw = await ipc.fsReadFile(`${home}/.claude/settings.json`).catch(() => null);
  const env = (parseJsonLoose(raw)?.env as Record<string, unknown> | undefined) ?? null;
  const baseUrl = typeof env?.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL.trim() : undefined;
  const key = (typeof env?.ANTHROPIC_AUTH_TOKEN === "string" ? env.ANTHROPIC_AUTH_TOKEN.trim() : undefined)
    ?? (typeof env?.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : undefined);
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
  const oauth = (parseJsonLoose(cred)?.claudeAiOauth as Record<string, unknown> | undefined) ?? null;
  if (typeof oauth?.accessToken === "string" && oauth.accessToken.trim()) {
    return [
      {
        providerId: "anthropic",
        title: "Claude 官方订阅",
        windows: [],
        note: t("已登录;官方订阅额度请在 CLI 内 /usage 查看"),
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

/* ── opencode(auth.json 供应商表 → vendor 检测) ────────── */

async function listOpencodeCredentials(): Promise<EngineCredential[]> {
  const entries = await listOpencodeAuthEntries();
  const out: EngineCredential[] = [];
  /* 逐个顺序探测(reduce Promise 链保序,同 listOmpCredentials)。 */
  await entries.reduce<Promise<void>>(
    (chain, { providerId, key }) =>
      chain.then(async () => {
        const vendor = detectVendorByProviderId(providerId);
        if (!vendor) {
          out.push({ providerId, title: providerId, windows: [], note: t("已登录") });
          return;
        }
        /* oauth 型无 key(如 openai ChatGPT 档):查不了额度,按已登录展示。 */
        if (!key) {
          out.push({ providerId, title: VENDOR_TITLE[vendor], windows: [], note: t("已登录") });
          return;
        }
        out.push(await toCredential(providerId, vendor, { key }));
      }),
    Promise.resolve(),
  );
  return out;
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
    case "opencode":
      return listOpencodeCredentials();
    default:
      return [];
  }
}
