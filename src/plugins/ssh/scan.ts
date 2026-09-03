/**
 * ~/.ssh/config 扫描导入 —— 路径展开覆盖 POSIX/Windows 常见写法。
 * 解析 Host/HostName/User/Port/IdentityFile,identity 路径跨平台展开,
 * 私钥 PEM 头校验后内联进候选(连接时不再依赖磁盘文件)。
 */

import { ipc, type SshHostConfig } from "@kernel/ipc";

export interface SshImportCandidate {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  privateKey: string;
  privateKeyPath: string;
  /** 与 settings.ssh.hosts 已有条目重复(host+port+username 归一比对)。 */
  duplicate: boolean;
}

interface ParsedSshHost {
  alias: string;
  host: string;
  username: string;
  port: number;
  identityFile: string;
}

const DEFAULT_SSH_PORT = 22;
const SSH_CONFIG_PATH = ".ssh/config";
const BRACED_HOME = "$" + "{HOME}";

type PathProfile = "windows" | "posix";

function pathProfileFromHome(homePath: string): PathProfile {
  return /^[a-zA-Z]:[\\/]/.test(homePath) ? "windows" : "posix";
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function stripWrappingQuotes(path: string) {
  return path.replace(/^(['"])(.*)\1$/, "$2");
}

function isWindowsAbsolutePath(path: string) {
  return /^([a-zA-Z]:[\\/]|\\\\)/.test(path);
}

function joinIdentityPath(homePath: string, child: string, profile: PathProfile) {
  /* 保 home 原生分隔符(Windows 反斜杠),只去尾斜杠;子路径去头斜杠。 */
  const home = homePath.replace(/[\\/]+$/, "");
  const trimmedChild = child.replace(/^[\\/]+/, "");
  return profile === "windows" ? `${home}\\${trimmedChild}` : `${home}/${trimmedChild}`;
}

function basename(path: string) {
  return normalizePath(path).split("/").pop() ?? "";
}

function parsePort(value: string | undefined) {
  const port = Number(value ?? "");
  if (!Number.isFinite(port)) return DEFAULT_SSH_PORT;
  const normalized = Math.floor(port);
  return normalized >= 1 && normalized <= 65535 ? normalized : DEFAULT_SSH_PORT;
}

function isWildcardHost(alias: string) {
  return alias.includes("*") || alias.includes("?") || alias.startsWith("!");
}

function stripInlineComment(line: string) {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index).trim() : line.trim();
}

/** ~/.ssh/config 主机段解析:Host 别名(通配丢弃)+ 后续选项键值。 */
export function parseSshConfig(content: string): ParsedSshHost[] {
  const hosts: ParsedSshHost[] = [];
  let aliases: string[] = [];
  let options = new Map<string, string>();

  const flush = () => {
    for (const alias of aliases.filter((alias) => alias && !isWildcardHost(alias))) {
      hosts.push({
        alias,
        host: options.get("hostname")?.trim() || alias,
        username: options.get("user")?.trim() || "",
        port: parsePort(options.get("port")),
        identityFile: options.get("identityfile")?.trim() || "",
      });
    }
    aliases = [];
    options = new Map<string, string>();
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine);
    if (!line) continue;
    const [rawKey = "", ...rest] = line.split(/\s+/);
    const key = rawKey.toLowerCase();
    const value = rest.join(" ").trim();
    if (key === "host") {
      flush();
      aliases = rest.map((item) => item.trim()).filter(Boolean);
      continue;
    }
    if (aliases.length > 0 && key && value) {
      options.set(key, value);
    }
  }
  flush();
  return hosts;
}

/** identity 路径跨平台展开:~/、$HOME/、${HOME}/、%USERPROFILE%、%HOMEDRIVE%%HOMEPATH%。 */
export function expandIdentityPath(homePath: string, path: string) {
  const profile = pathProfileFromHome(homePath);
  const trimmed = stripWrappingQuotes(path);
  if (!trimmed) return "";
  if (profile === "windows") {
    if (isWindowsAbsolutePath(trimmed)) return trimmed;
    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
      return joinIdentityPath(homePath, trimmed.slice(2), profile);
    }
    if (trimmed.startsWith("$HOME/") || trimmed.startsWith("$HOME\\")) {
      return joinIdentityPath(homePath, trimmed.slice(6), profile);
    }
    if (trimmed.startsWith(`${BRACED_HOME}/`) || trimmed.startsWith(`${BRACED_HOME}\\`)) {
      return joinIdentityPath(homePath, trimmed.slice(BRACED_HOME.length + 1), profile);
    }
    if (/^%USERPROFILE%[\\/]/i.test(trimmed)) {
      return joinIdentityPath(homePath, trimmed.slice("%USERPROFILE%".length), profile);
    }
    if (/^%HOMEDRIVE%%HOMEPATH%[\\/]/i.test(trimmed)) {
      return joinIdentityPath(
        homePath,
        trimmed.slice("%HOMEDRIVE%%HOMEPATH%".length),
        profile,
      );
    }
    if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return trimmed;
    return joinIdentityPath(homePath, trimmed, profile);
  }
  if (trimmed.startsWith("~/")) return joinIdentityPath(homePath, trimmed.slice(2), profile);
  if (trimmed.startsWith("$HOME/")) return joinIdentityPath(homePath, trimmed.slice(6), profile);
  if (trimmed.startsWith(`${BRACED_HOME}/`)) {
    return joinIdentityPath(homePath, trimmed.slice(BRACED_HOME.length + 1), profile);
  }
  if (trimmed.startsWith("/")) return trimmed.replace(/\/+$/, "");
  return joinIdentityPath(homePath, trimmed, profile);
}

function toHomeRelativePath(homePath: string, path: string) {
  const profile = pathProfileFromHome(homePath);
  const home = profile === "windows" ? `${normalizePath(homePath)}/` : `${homePath.replace(/\/+$/, "")}/`;
  const normalized = profile === "windows" ? normalizePath(path) : path;
  return normalized.startsWith(home) ? normalized.slice(home.length) : "";
}

function isLikelyPrivateKeyPath(path: string) {
  const name = basename(path);
  if (!name || name.endsWith(".pub")) return false;
  if (["config", "known_hosts", "known_hosts.old", "authorized_keys", "authorized_keys2"].includes(name)) {
    return false;
  }
  return name.startsWith("id_") || !name.includes(".");
}

export function isPrivateKeyContent(content: string) {
  return /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/m.test(content.trim());
}

export function sshHostIdentityKey(host: Pick<SshHostConfig, "host" | "port" | "username">) {
  return `${host.host.trim().toLowerCase()}|${host.port || DEFAULT_SSH_PORT}|${host.username
    .trim()
    .toLowerCase()}`;
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return "";
  }
}

export interface SshScanResult {
  homePath: string;
  candidates: SshImportCandidate[];
  keyFiles: string[];
}

/** 扫描 ~/.ssh/config + ~/.ssh/ 私钥,产出导入候选(已配置条目标重)。 */
export async function scanSshImportCandidates(
  existingHosts: SshHostConfig[] = [],
): Promise<SshScanResult> {
  const homePath = (await ipc.configHomeDir()).replace(/[\\/]+$/, "");
  if (!homePath) throw new Error("无法定位用户目录");

  const configContent = await readOptionalFile(`${homePath}/${SSH_CONFIG_PATH}`);
  const parsedHosts = parseSshConfig(configContent);

  const keyFiles: string[] = [];
  const keyContentByPath = new Map<string, string>();
  try {
    const entries = await ipc.fsListDir(`${homePath}/.ssh`);
    for (const entry of entries) {
      if (!entry.isDir && isLikelyPrivateKeyPath(entry.path)) keyFiles.push(entry.path);
    }
  } catch {
    /* ~/.ssh 不存在:仅 config 候选。 */
  }
  for (const keyPath of keyFiles) {
    const content = await readOptionalFile(keyPath);
    if (isPrivateKeyContent(content)) {
      keyContentByPath.set(normalizePath(keyPath), content.trim());
    }
  }

  const existingKeys = new Set(existingHosts.map(sshHostIdentityKey));
  const candidates = parsedHosts.map((host) => {
    const identityPath = expandIdentityPath(homePath, host.identityFile);
    const identityRelative = identityPath ? toHomeRelativePath(homePath, identityPath) : "";
    const privateKey =
      keyContentByPath.get(normalizePath(identityPath)) ??
      (identityRelative ? keyContentByPath.get(normalizePath(identityRelative)) ?? "" : "");
    const candidate: SshImportCandidate = {
      name: host.alias,
      host: host.host,
      port: host.port,
      username: host.username,
      authType: identityPath || privateKey ? "privateKey" : "password",
      privateKey,
      privateKeyPath: identityPath,
      duplicate: false,
    };
    return { ...candidate, duplicate: existingKeys.has(sshHostIdentityKey(candidate)) };
  });

  return { homePath, candidates, keyFiles: [...keyContentByPath.keys()].sort() };
}
