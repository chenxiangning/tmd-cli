/**
 * SSH 设置域清洗 —— settings.ssh.hosts 的 sanitize(自 settings.ts 拆件,
 * 文件规模铁则)。类型契约见 sshTypes.ts;schema 归属仍是 settings.ts。
 */

import type { SshHostConfig, SshProxyConfig } from "./sshTypes";

const SSH_HOSTS_MAX = 200;
const SSH_TEXT_MAX = 4000;
const SSH_AUTH_TYPES = ["password", "privateKey", "keyboardInteractive"];

function sanitizeSshText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function sanitizeSshPort(raw: unknown): number {
  const port = typeof raw === "number" ? Math.trunc(raw) : 0;
  return port >= 1 && port <= 65535 ? port : 0;
}

function sanitizeSshProxy(raw: unknown): SshProxyConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const proxy = raw as Record<string, unknown>;
  const type = String(proxy.type ?? "");
  if (!["", "http", "socks5", "socks"].includes(type)) return undefined;
  const url = sanitizeSshText(proxy.url, 400);
  const port = sanitizeSshPort(proxy.port);
  const username = sanitizeSshText(proxy.username, 200);
  if (!url && port === 0 && !username) return undefined;
  return {
    type: type === "socks" ? "socks5" : type,
    url,
    port,
    username,
    password: sanitizeSshText(proxy.password, SSH_TEXT_MAX),
  };
}

/** SSH 主机簿清洗:必填 id/host/username,重复 id 去重(先到先得),凭据字段截断保形。 */
export function sanitizeSshSettings(raw: unknown): { hosts: SshHostConfig[] } {
  if (!raw || typeof raw !== "object") return { hosts: [] };
  const list = (raw as { hosts?: unknown }).hosts;
  if (!Array.isArray(list)) return { hosts: [] };
  const hosts: SshHostConfig[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, SSH_HOSTS_MAX)) {
    if (!item || typeof item !== "object") continue;
    const host = item as Record<string, unknown>;
    const id = sanitizeSshText(host.id, 100);
    const address = sanitizeSshText(host.host, 255);
    const username = sanitizeSshText(host.username, 100);
    if (!id || !address || !username || seen.has(id)) continue;
    seen.add(id);
    const authType = SSH_AUTH_TYPES.includes(String(host.authType))
      ? String(host.authType)
      : "password";
    hosts.push({
      id,
      name: sanitizeSshText(host.name, 100),
      host: address,
      port: sanitizeSshPort(host.port),
      username,
      authType,
      password: sanitizeSshText(host.password, SSH_TEXT_MAX),
      privateKey: sanitizeSshText(host.privateKey, 64_000),
      privateKeyPath: sanitizeSshText(host.privateKeyPath, 1000),
      privateKeyPassphrase: sanitizeSshText(host.privateKeyPassphrase, SSH_TEXT_MAX),
      proxy: sanitizeSshProxy(host.proxy),
    });
  }
  return { hosts };
}

