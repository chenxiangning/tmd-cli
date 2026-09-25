/**
 * 自建中继部署历史域 —— 一键部署成功后 Rust 落盘的 SSH 连接信息(含密码/口令,
 * 点历史即整表回填免重输;明文存储对齐 settings.ssh.hosts 既有纪律与风险记录),
 * 私钥内容不落盘(路径在,Rust 按路径读)。下次部署从历史点选回填表单。
 * 类型 + 清洗同域文件(先例:settingsAppearance.ts);字段装配在 settingsSanitize.ts;
 * upsert 在 Rust persist_selfhost。键 = host:port:username(覆盖刷新 savedAt);上限 10。
 */

export interface RelayDeployHistoryEntry {
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  /** 私钥认证时记录的读取路径(内容不落盘)。 */
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  savedAt: number;
}

export const RELAY_DEPLOY_HISTORY_MAX = 10;

/** 清洗:非数组回落空;条目按字段白名单收紧(host/user 截断、port 1-65535、authType 二选一、savedAt 数值),坏条目整个丢。 */
export function sanitizeRelayDeployHistory(raw: unknown): RelayDeployHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RelayDeployHistoryEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const host = typeof e.host === "string" ? e.host.trim().slice(0, 200) : "";
    const username = typeof e.username === "string" ? e.username.trim().slice(0, 100) : "";
    const port = Number(e.port);
    if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    out.push({
      host,
      username,
      port,
      authType: e.authType === "privateKey" ? "privateKey" : "password",
      ...(typeof e.privateKeyPath === "string" && e.privateKeyPath.trim()
        ? { privateKeyPath: e.privateKeyPath.trim().slice(0, 500) }
        : {}),
      ...(typeof e.password === "string" && e.password ? { password: e.password.slice(0, 500) } : {}),
      ...(typeof e.passphrase === "string" && e.passphrase ? { passphrase: e.passphrase.slice(0, 500) } : {}),
      savedAt: typeof e.savedAt === "number" ? e.savedAt : 0,
    });
  }
  return out.slice(0, RELAY_DEPLOY_HISTORY_MAX);
}
