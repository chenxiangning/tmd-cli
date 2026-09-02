/**
 * 网络代理编辑器的提交逻辑(纯函数,契约测试见 proxyCommit.test.ts)。
 *
 * 语义(对齐 codemoss 网络代理 + tmd-cli 无保存按钮习惯):
 * - 滑动块切换即时提交;地址输入 blur/Enter 提交;
 * - 空地址在启用态回落默认地址(文本框亦预填默认,正常编辑不会走到);
 * - 格式校验失败返回错误文案,由浮层 inline 展示、不落 store;
 * - Rust proxy.rs 用 reqwest 做同构兜底校验(手改 JSON 场景)。
 */

/** 默认代理地址:文本框预填值 + 启用态空地址回落(codemoss 同款)。 */
export const DEFAULT_PROXY_URL = "http://127.0.0.1:7890";

/** 支持的代理 scheme(reqwest + socks feature 的能力面)。 */
const PROXY_SCHEMES = ["http:", "https:", "socks5:", "socks5h:"] as const;

/**
 * 地址归一:trim;启用态空地址回落默认地址,关闭态保留空(不硬塞默认,
 * 用户显式清空 = 不想留痕;重开浮层时文本框仍会预填默认)。
 */
export function normalizeProxyUrl(url: string, enabled: boolean): string {
  const trimmed = url.trim();
  return enabled && !trimmed ? DEFAULT_PROXY_URL : trimmed;
}

/**
 * 校验代理地址格式。空串放行(空/留空的语义由 normalizeProxyUrl 决定);
 * 返回 null = 合法,否则为用户可读错误。
 */
export function proxyTransitionError(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "代理地址格式无效,应为 http(s)://host:port 或 socks5://host:port。";
  }
  if (!PROXY_SCHEMES.includes(parsed.protocol as (typeof PROXY_SCHEMES)[number])) {
    return `不支持的代理协议 ${parsed.protocol},仅支持 http(s) / socks5。`;
  }
  if (!parsed.hostname) {
    return "代理地址缺少主机名。";
  }
  return null;
}
