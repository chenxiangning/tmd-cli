/**
 * 引擎凭据盘点 —— 公共类型与收口(各引擎磁盘盘点实现见 credentialsEngines.ts)。
 *
 * - 只用通用 IPC 原语(fsReadFile / sqliteQuery / configHomeDir)+ cli-shared
 *   共享格式库,不依赖其它 cli-* 插件实现(插件零直接依赖铁律);
 * - 拿不到额度 ≠ 错误:显示"已登录/已配置",不猜接口(对齐 quota 体系既有原则);
 * - $ENV_VAR 引用不解析(welcome 是盘点视角,不是发送链路,显示已配置即可)。
 */

import {
  fetchVendorQuota,
  VENDOR_TITLE,
  type VendorCredential,
  type VendorId,
} from "../cli-shared/quota/vendors";
import type { QuotaWindow } from "@kernel/quota";
import {
  listClaudeCredentials,
  listCodexCredentials,
  listGrokCredentials,
  listOpencodeCredentials,
  listOmpCredentials,
  listPiCredentials,
} from "./credentialsEngines";

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
/** 凭据 → VendorQuota → EngineCredential 的公共收口。
 *  供应商额度接口偶发瞬断(代理出口轮换触发风控等),失败退避 400ms 重试一次。 */
export async function toCredential(
  providerId: string,
  vendor: VendorId,
  cred: VendorCredential,
  baseUrl?: string,
): Promise<EngineCredential> {
  const title = VENDOR_TITLE[vendor] ?? providerId;
  const attempt = async (): Promise<EngineCredential> => {
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
  };
  const first = await attempt();
  if (!first.note) return first;
  /* 退避:Promise.withResolvers 线性等待 */
  const { promise: backoff, resolve: backoffResolve } = Promise.withResolvers<void>();
  setTimeout(backoffResolve, 400);
  await backoff;
  const second = await attempt();
  return second.note ? first : second;
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
