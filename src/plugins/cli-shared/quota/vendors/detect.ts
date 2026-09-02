/* ── 供应商识别与展示 ─────────────────────────────────── */

import type { VendorId } from "./types";

/** provider id 归一: "vendor/model" → "vendor";空/哨兵 → null。 */
export function vendorFromModel(model?: string | null): string | null {
  const first = model?.trim().split("/")[0]?.trim() ?? "";
  if (!first || (first.startsWith("__") && first.endsWith("__"))) return null;
  return first;
}

/** 按 CLI 内 provider id 识别供应商(omp agent.db / pi auth.json 的 key)。 */
export function detectVendorByProviderId(id: string): VendorId | null {
  const v = id.trim().toLowerCase();
  switch (v) {
    case "kimi-coding":
    case "kimi-code":
    case "kimi":
      return "kimi";
    case "minimax-cn":
    case "minimax-code-cn":
      return "minimax-cn";
    case "minimax":
    case "minimax-code":
    case "minimax-code-en":
      return "minimax-en";
    case "zai-coding-cn":
    case "zai-coding":
    case "zai":
    case "zhipu":
    case "zhipuai":
    case "zhipu-coding":
    case "zhipu-coding-plan":
    case "zhipuai-coding-plan":
    case "glm":
    case "glm-cn":
    case "glm-coding":
    case "glm-coding-cn":
    case "bigmodel":
    case "bigmodel-cn":
      return "zhipu-cn";
    case "zai-coding-en":
    case "zai-en":
    case "zhipu-en":
    case "glm-en":
    case "glm-coding-en":
      return "zhipu-en";
    case "deepseek":
    case "deepseek-official":
      return "deepseek";
    case "openai":
    case "openai-codex":
      return "openai-codex";
    default:
      return null;
  }
}

/** 按 base_url 识别供应商(对齐 codemoss detect_provider);未知返回 "relay"。 */
export function detectVendorByBaseUrl(baseUrl: string): VendorId {
  const url = baseUrl.toLowerCase();
  if (url.includes("api.kimi.com/coding")) return "kimi";
  if (url.includes("bigmodel.cn")) return "zhipu-cn";
  if (url.includes("api.z.ai")) return "zhipu-en";
  if (url.includes("api.minimaxi.com")) return "minimax-cn";
  if (url.includes("api.minimax.io")) return "minimax-en";
  if (url.includes("deepseek.com")) return "deepseek";
  if (
    url.includes("coding.dashscope.aliyuncs.com") ||
    url.includes("coding-intl.dashscope.aliyuncs.com")
  ) {
    return "unsupported";
  }
  return "relay";
}
