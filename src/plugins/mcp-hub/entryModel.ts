/**
 * server 条目模型小件 —— transport 推断 + 摘要行 + 密钥列判定
 * (ServersView / ServerEditModal / importScan / probe 共用;纯函数)。
 */

import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";

export type McpTransport = "stdio" | "http" | "sse";

/** transport 推断:显式 type 优先(streamable-http 归 http);缺省
 *  command → stdio / url → http;都没有 → stdio(空表单基线)。 */
export function inferTransport(entry: McpServerEntry): McpTransport {
  const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  if (type === "stdio") return "stdio";
  if (type === "sse") return "sse";
  if (type === "http" || type === "streamable-http" || type === "streamable_http") return "http";
  if (typeof entry.url === "string" && entry.url) return "http";
  return "stdio";
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 卡片摘要行:stdio = command + args;remote = url(截断由 CSS ellipsis 处理)。 */
export function summarizeEntry(entry: McpServerEntry): string {
  if (inferTransport(entry) === "stdio") {
    const parts = [entry.command, ...stringArray(entry.args)].filter(
      (x): x is string => typeof x === "string" && x !== "",
    );
    return parts.join(" ") || "—";
  }
  return typeof entry.url === "string" && entry.url ? entry.url : "—";
}

/** env/headers 值列是否按密钥掩码显示(key 词形判定,settingsRelay sanitize 同思路)。 */
export function isSecretishKey(key: string): boolean {
  return /token|secret|key|password|authorization|credential/i.test(key);
}

/** 值脱敏:疑似密钥的值列回显为固定长度掩码(不回明文,长度也不泄漏)。 */
export function maskValue(key: string, value: string): string {
  return isSecretishKey(key) && value ? "••••••" : value;
}
