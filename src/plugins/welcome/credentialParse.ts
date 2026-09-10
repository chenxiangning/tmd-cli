/**
 * 凭据盘 JSON 容错解析(自 credentials.ts 拆出,文件规模铁则)。
 *
 * - parseJsonLoose:磁盘文件可能截断/损坏,裸抛会让整个凭据区静默消失
 *   (调用方 CredentialList 无 catch,还附带 unhandled rejection)。
 * - parseCredentialData:omp auth row JSON → VendorCredential 投影。
 * - asObj / asStr:类型缩窄助手。
 */

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** JSON.parse 容错:失败/空都返回 null。 */
export function parseJsonLoose(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asObj(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** omp auth row JSON → VendorCredential 投影。 */
export function parseCredentialData(
  raw: string,
): { key?: string; access?: string; accountId?: string } {
  const parsed = parseJsonLoose(raw);
  if (!parsed) return {};
  return {
    key: asStr(parsed.key),
    access: asStr(parsed.access),
    accountId: asStr(parsed.accountId),
  };
}
