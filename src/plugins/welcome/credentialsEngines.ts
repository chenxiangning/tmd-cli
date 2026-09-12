/**
 * 各引擎凭据盘点实现(自 credentials.ts 拆出,300 行铁则)。
 * omp/pi/codex/claude/grok/opencode 各自的磁盘格式知识(经 cli-shared 消费)
 * 集中于此;公共收口 toCredential 与类型留在 credentials.ts。
 */

import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  VENDOR_TITLE,
} from "../cli-shared/quota/vendors";
import {
  codexPlanLabelWithSnapshot,
  readCodexLocalQuota,
} from "../cli-shared/quota/codexLocal";
import { resolveGrokDefaultProfile } from "../cli-shared/grokConfig";
import {
  listOmpAuthProviders,
  readOmpAuthCredential,
} from "../cli-shared/quota/ompAuth";
import { listOpencodeAuthEntries } from "../cli-shared/opencodeDisk";
import { parseJsonLoose, parseCredentialData } from "./credentialParse";
import type { EngineCredential } from "./credentials";
import { toCredential } from "./credentials";

/* ── omp(agent.db provider 列表 + 凭据数据) ──────────────── */
export async function listOmpCredentials(): Promise<EngineCredential[]> {
  const providers = await listOmpAuthProviders();
  const out: EngineCredential[] = [];
  /* 逐个顺序探测(reduce Promise 链保序):凭据/额度读取不并发打满。
     per-provider try/catch:单供应商异常不拖垮整表(其余供应商照常显示)。 */
  await providers.reduce<Promise<void>>(
    (chain, providerId) =>
      chain.then(async () => {
        try {
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
        } catch (err) {
          out.push({
            providerId,
            title: providerId,
            windows: [],
            note: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    Promise.resolve(),
  );
  return out;
}

/* ── pi(auth.json provider keys) ───────────────────────── */

export async function listPiCredentials(): Promise<EngineCredential[]> {
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
        try {
          const vendor = detectVendorByProviderId(providerId);
          if (!vendor) return;
          /* asObj 语义内联:非对象条目一律视为无凭据;key 必须 trim 后非空串
             (原 asStr 的 typeof 收窄,勿用 as 断言——放过非字符串会带病下探)。 */
          const entry = entryRaw && typeof entryRaw === "object" ? (entryRaw as Record<string, unknown>) : null;
          const rawKey = entry?.apiKey ?? entry?.key;
          const key = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : undefined;
          if (vendor === "openai-codex") {
            /* 官方 OAuth → 本地 rollout 快照(零 HTTP);异常降级"已登录"。 */
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
          out.push(await toCredential(providerId, vendor, { key }));
        } catch (err) {
          out.push({
            providerId,
            title: providerId,
            windows: [],
            note: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    Promise.resolve(),
  );
  return out;
}

/* ── codex(auth.json OAuth → 本地快照) ─────────────────── */

export async function listCodexCredentials(): Promise<EngineCredential[]> {
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

export async function listClaudeCredentials(): Promise<EngineCredential[]> {
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

export async function listGrokCredentials(): Promise<EngineCredential[]> {
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

export async function listOpencodeCredentials(): Promise<EngineCredential[]> {
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
