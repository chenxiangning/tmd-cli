/**
 * pi CLI 额度 provider ── 凭据适配层。
 *
 * 凭据源(实证 ~/.pi/agent,目录可被 PI_CODING_AGENT_DIR 覆盖):
 * - auth.json: Record<providerId, { key } | { access, accountId, refresh, expires, type }>
 *   本机实证 vendors: deepseek / kimi-coding / minimax-cn / openai-codex / zai-coding-cn
 * - models-store.json: Record<providerId, { models: [{ id }] }>
 *   裸模型 id → provider 反查(session jsonl 只有 modelId 没有 provider 时用)。
 * - models.json (JSONC): Record<providerId, { baseUrl, apiKey, models }>
 *   中转站 baseUrl 与 apiKey 的真实来源(auth.json 无中转站条目)。
 *
 * 路由优先级:
 * 1. model "provider/modelId" 前缀(provider 由 session jsonl model_change 事件提供,最可靠)
 * 2. 裸 modelId → models-store/models.json 反查 provider(凭据存在性消歧)
 * 3. 无 model → auth 仅配置单供应商时安全回退;多供应商拒绝猜
 *
 * 兼容凭据引用: `$ENV_VAR` 从环境变量取值;`!command` 不执行 shell,显式报不支持。
 * HTTP 调用全部走 cli-shared/quota/vendors.ts 共同能力。
 */

import { ipc } from "@kernel/ipc";
import {
  registerQuotaProvider,
  type QuotaFetchContext,
  type QuotaSnapshot,
} from "@kernel/quota";
import {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  fetchVendorQuota,
  VENDOR_TITLE,
  vendorFromModel,
  type VendorCredential,
  type VendorId,
} from "../cli-shared/quota/vendors";
import {
  codexPlanLabelWithSnapshot,
  readCodexLocalQuota,
} from "../cli-shared/quota/codexLocal";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/* ── JSONC 解析(models.json 带注释)────────────────────── */

/**
 * 最小 JSONC 归一:剥离 // 与 块注释、尾逗号,字符串字面量原样保留。
 * pi models.json 实证只有这两种非标准语法,不引入第三方解析器。
 */
export function parseJsonc(raw: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  // 尾逗号: , 后直接跟 } 或 ](允许中间空白)
  const noTrailing = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailing);
}

/* ── 磁盘读取(薄 IO)────────────────────────────────────── */

type PiAuthEntry = {
  key?: string;
  access?: string;
  accountId?: string;
};

/** models-store.json 实证只有 models 列表(baseUrl 只存在于 models.json)。 */
type PiStoreProvider = {
  models?: Array<{ id?: string }>;
};

type PiModelsJsonProvider = {
  baseUrl?: string;
  apiKey?: string;
  models?: Array<{ id?: string }>;
};

/** pi 全部本地配置,一次读齐喂给纯路由函数。 */
export interface PiLocalConfig {
  auth: Record<string, PiAuthEntry>;
  store: Record<string, PiStoreProvider>;
  modelsJson: Record<string, PiModelsJsonProvider>;
}

/** pi 配置目录默认 ~/.pi/agent;允许 PI_CODING_AGENT_DIR 覆盖。 */
export async function piAgentDir(): Promise<string> {
  const configured = await ipc.quotaEnvValue(AGENT_DIR_ENV);
  if (configured) return configured.replace(/[\\/]+$/, "");
  return `${await ipc.configHomeDir()}/.pi/agent`;
}

/** JSON 边界收窄:object → Record;字段级类型由消费点 typeof 守卫。 */
function asStringKeyedMap(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // 已通过 typeof 收窄为 object;字段值保持 unknown,消费点逐一校验。
    const map: Record<string, unknown> = v as Record<string, unknown>;
    return map;
  }
  return {};
}

async function readPiLocalConfig(): Promise<PiLocalConfig> {
  const dir = await piAgentDir();
  const [authRaw, storeRaw, modelsRaw] = await Promise.all([
    ipc.fsReadFile(`${dir}/auth.json`).then(JSON.parse).catch(() => null),
    ipc.fsReadFile(`${dir}/models-store.json`).then(JSON.parse).catch(() => null),
    ipc.fsReadFile(`${dir}/models.json`).then(parseJsonc).catch(() => null),
  ]);
  const modelsMap = asStringKeyedMap(modelsRaw);
  const providersRaw = "providers" in modelsMap ? modelsMap.providers : null;
  return {
    auth: asStringKeyedMap(authRaw) as PiLocalConfig["auth"],
    store: asStringKeyedMap(storeRaw) as PiLocalConfig["store"],
    modelsJson: asStringKeyedMap(providersRaw) as PiLocalConfig["modelsJson"],
  };
}

/* ── 纯路由(可测)──────────────────────────────────────── */

interface PiRoute {
  providerId: string;
  vendor: VendorId;
  /** relay 探测需要;已知供应商为空。 */
  baseUrl?: string;
  /** 原始凭据,字段可能是 $ENV_VAR 引用,需 resolveCredentialRefs。 */
  credential: VendorCredential;
}

/** 裸模型 id → 配置了该模型的 provider 列表(store 优先,models.json 补充)。 */
export function providersForModelId(
  config: Pick<PiLocalConfig, "store" | "modelsJson">,
  modelId: string,
): string[] {
  const hasModel = (models: unknown): boolean =>
    Array.isArray(models) &&
    models.some((m) => m && typeof m === "object" && "id" in m && m.id === modelId);
  const out: string[] = [];
  for (const [pid, cfg] of Object.entries(config.store)) {
    if (cfg && typeof cfg === "object" && hasModel(cfg.models)) out.push(pid);
  }
  for (const [pid, cfg] of Object.entries(config.modelsJson)) {
    if (!out.includes(pid) && cfg && typeof cfg === "object" && hasModel(cfg.models)) out.push(pid);
  }
  return out;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** provider 的 baseUrl:只认 models.json(pi 实证;models-store.json 无此字段)。 */
function providerBaseUrl(config: PiLocalConfig, providerId: string): string | undefined {
  return firstString(config.modelsJson[providerId]?.baseUrl);
}

/** 该 provider 是否存在任一凭据来源(用于裸 id 多候选消歧)。 */
function hasCredential(config: PiLocalConfig, providerId: string, vendor: VendorId): boolean {
  if (credentialFrom(config.auth[providerId])) return true;
  if (firstString(config.modelsJson[providerId]?.apiKey)) return true;
  return Object.entries(config.auth).some(
    ([pid, e]) =>
      pid !== providerId && detectVendorByProviderId(pid) === vendor && credentialFrom(e),
  );
}

/** auth entry → 凭据(字段经 typeof 守卫;entry 无有效字段返回 null)。 */
function credentialFrom(entry?: PiAuthEntry): VendorCredential | null {
  if (!entry || typeof entry !== "object") return null;
  const key = firstString(entry.key);
  const access = firstString(entry.access);
  if (!key && !access) return null;
  return { key, access, accountId: firstString(entry.accountId) };
}

/**
 * 凭据选择:精确 provider → 语义 vendor 匹配(模型前缀 kimi-code 与 auth key kimi-coding 可不同)
 * → models.json apiKey(中转站实证)。
 */
function rawCredential(
  config: PiLocalConfig,
  providerId: string,
  vendor: VendorId,
): VendorCredential | null {
  const exact = credentialFrom(config.auth[providerId]);
  if (exact) return exact;
  const semanticEntry = Object.entries(config.auth).find(
    ([pid]) => detectVendorByProviderId(pid) === vendor,
  )?.[1];
  const semantic = credentialFrom(semanticEntry);
  if (semantic) return semantic;
  const apiKey = firstString(config.modelsJson[providerId]?.apiKey);
  return apiKey ? { key: apiKey } : null;
}

/** 单个 providerId → vendor + baseUrl;识别不出返回 null。 */
function detectRoute(
  config: PiLocalConfig,
  providerId: string,
): { vendor: VendorId; baseUrl?: string } | null {
  const known = detectVendorByProviderId(providerId);
  if (known) return { vendor: known };
  const baseUrl = providerBaseUrl(config, providerId);
  if (!baseUrl) return null;
  return { vendor: detectVendorByBaseUrl(baseUrl), baseUrl };
}

/**
 * 纯路由决策:给定本地配置与当前模型,选出 provider/vendor/凭据。
 * 不猜:无法唯一确定时抛带候选信息的错误。
 */
export function resolvePiRoute(
  config: PiLocalConfig,
  model?: string | null,
): PiRoute {
  const text = model?.trim() ?? "";
  // 仅 "provider/model" 形式才走前缀;裸 id(如 glm-5.2)不是供应商名。
  let providerId = text.includes("/") ? vendorFromModel(text) : null;

  if (!providerId) {
    const bareId =
      text && !text.includes("/") && !(text.startsWith("__") && text.endsWith("__"))
        ? text
        : null;
    if (bareId) {
      // 裸 modelId:反查 provider,用凭据存在性消歧
      const candidates = providersForModelId(config, bareId);
      const routed = candidates
        .map((pid) => ({ pid, route: detectRoute(config, pid) }))
        .filter((c): c is { pid: string; route: { vendor: VendorId; baseUrl?: string } } => c.route !== null);
      const withCred = routed.filter((c) => hasCredential(config, c.pid, c.route.vendor));
      if (withCred.length === 1) {
        providerId = withCred[0].pid;
      } else if (withCred.length > 1) {
        throw new Error(
          `模型 ${bareId} 匹配多个已配置供应商 (${withCred.map((c) => c.pid).join(", ")}),无法路由`,
        );
      } else if (candidates.length > 0) {
        throw new Error(`模型 ${bareId} 属于 ${candidates.join(", ")},但均无凭据`);
      }
    }
    if (!providerId) {
      const configured = Object.keys(config.auth);
      // model 完全缺失时,只有唯一供应商才可安全回退;多供应商继续拒绝猜。
      if (configured.length !== 1) {
        throw new Error("未识别当前模型,且 pi 配置了多个供应商,无法路由");
      }
      providerId = configured[0];
    }
  }

  const route = detectRoute(config, providerId);
  if (!route) {
    throw new Error(`未知供应商 ${providerId},且 models.json 无 baseUrl`);
  }
  // openai-codex 允许空凭据:fetchPiQuota 里 OAuth → 本地快照,非 OAuth → wham 显式报错。
  const credential =
    route.vendor === "openai-codex" ? {} : rawCredential(config, providerId, route.vendor);
  if (!credential) {
    throw new Error(`pi 未配置供应商 ${providerId} 的凭据 (auth.json / models.json)`);
  }
  return { providerId, vendor: route.vendor, baseUrl: route.baseUrl, credential };
}

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

async function fetchPiQuota(ctx: QuotaFetchContext): Promise<QuotaSnapshot> {
  const config = await readPiLocalConfig();
  const route = resolvePiRoute(config, ctx.model);
  // codex 供应商分级(与 cli-codex 同策略):官方 OAuth 登录走 CLI 本地快照,
  // 快照不可用降级 wham HTTP;非 OAuth 凭据直接走 HTTP。
  if (route.vendor === "openai-codex") {
    const cred = await resolveCredentialRefs(route.providerId, route.credential);
    if (cred.access && cred.accountId) {
      try {
        const local = await readCodexLocalQuota();
        return {
          providerLabel: route.providerId,
          title: VENDOR_TITLE["openai-codex"],
          usedLabel: "已使用",
          windows: local.windows,
          planLabel: codexPlanLabelWithSnapshot(local),
        };
      } catch {
        // 本地无快照(如从未在本机对话过)→ 降级 wham HTTP
      }
    }
    const quota = await fetchVendorQuota("openai-codex", cred);
    return {
      providerLabel: route.providerId,
      title: VENDOR_TITLE["openai-codex"],
      usedLabel: "已使用",
      windows: quota.windows,
      balanceText: quota.balanceText,
      planLabel: quota.planLabel,
    };
  }
  const cred = await resolveCredentialRefs(route.providerId, route.credential);
  const quota = await fetchVendorQuota(route.vendor, cred, route.baseUrl);
  return {
    providerLabel: route.providerId,
    title: VENDOR_TITLE[route.vendor] ?? `${route.providerId} 额度`,
    usedLabel: "已使用",
    windows: quota.windows,
    balanceText: quota.balanceText,
    planLabel: quota.planLabel,
  };
}

export function registerPiQuotaProvider(): void {
  registerQuotaProvider({
    profileId: "pi",
    fetch: fetchPiQuota,
  });
}
