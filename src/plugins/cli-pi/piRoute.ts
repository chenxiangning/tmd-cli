/**
 * pi quota 纯路由 —— 自 quota.ts 拆出(文件规模铁则)。
 *
 * 路由优先级:
 * 1. model "provider/modelId" 前缀(provider 由 session jsonl model_change 事件提供,最可靠)
 * 2. 裸 modelId → models-store/models.json 反查 provider(凭据存在性消歧)
 * 3. 无 model → auth 仅配置单供应商时安全回退;多供应商拒绝猜
 * 不猜:无法唯一确定时抛带候选信息的错误。
 * providersForModelId / resolvePiRoute 由 quota.ts re-export 维持既有导入契约。
 */

import {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  vendorFromModel,
  type VendorCredential,
  type VendorId,
} from "../cli-shared/quota/vendors";
import type { PiAuthEntry, PiLocalConfig } from "./piLocalConfig";

export interface PiRoute {
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
