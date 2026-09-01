/* ── 类型 ─────────────────────────────────────────────── */

import type { QuotaWindow } from "@kernel/quota";

/** 供应商 id(已含区域)。relay = 未知中转站,dashscope = 已知但无公开 API。 */
export type VendorId =
  | "kimi"
  | "minimax-cn"
  | "minimax-en"
  | "zhipu-cn"
  | "zhipu-en"
  | "deepseek"
  | "openai-codex"
  | "relay"
  | "unsupported";

/** CLI 凭据的公共子集:key 型(api_key)或 oauth 型(access+accountId)。 */
export interface VendorCredential {
  key?: string;
  access?: string;
  accountId?: string;
}

/** 供应商查询结果(喂给 QuotaSnapshot)。 */
export interface VendorQuota {
  windows: QuotaWindow[];
  /** 余额型供应商: 例 "¥12.50" / "$5.00"。 */
  balanceText?: string;
  planLabel?: string;
}

/** vendor → 额度卡片标题(全部 CLI 共享,避免各插件各抄一份)。 */
export const VENDOR_TITLE: Record<string, string> = {
  kimi: "KIMI 套餐额度",
  "minimax-cn": "MiniMax 套餐额度",
  "minimax-en": "MiniMax 套餐额度",
  "zhipu-cn": "智谱 套餐额度",
  "zhipu-en": "z.ai 套餐额度",
  deepseek: "DeepSeek 账户余额",
  "openai-codex": "Codex 账号额度",
  relay: "中转站额度",
};
