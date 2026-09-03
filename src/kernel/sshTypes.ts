/**
 * SSH/SFTP IPC 契约类型(对齐 src-tauri/src/ssh/*,serde camelCase)。
 * 纯类型件:命令封装与 @tauri-apps 收口仍在 ipc.ts(R3 铁则)。
 */

/** SSH 主机配置(settings.ssh.hosts 条目;凭据明文存储,spec 已记录风险)。 */
export interface SshHostConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** password | privateKey | keyboardInteractive。 */
  authType: string;
  password: string;
  /** 私钥内容(与 privateKeyPath 二选一,内容优先)。 */
  privateKey: string;
  privateKeyPath: string;
  privateKeyPassphrase: string;
  proxy?: SshProxyConfig;
}

export interface SshProxyConfig {
  /** "" | "http" | "socks5"。 */
  type: string;
  /** 代理地址(host、host:port 或带 scheme 的 URL)。 */
  url: string;
  port: number;
  username: string;
  password: string;
}

/** `ssh://event/{id}` 判别载荷:status(状态流转)/ forwards(转发快照)。 */
export type SshSessionEvent =
  | {
      kind: "status";
      status: "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";
      message?: string;
      reconnectAttempt: number;
      reconnectMaxAttempts: number;
    }
  | { kind: "forwards"; forwards: SshForwardInfo[] };

/** `ssh://prompt/{id}` 载荷:host key 信任 / KBI / 密码回落。 */
export interface SshPromptEvent {
  promptId: string;
  kind: "hostKey" | "kbi" | "password";
  keyType?: string;
  fingerprint?: string;
  storedFingerprint?: string;
  name?: string;
  instructions?: string;
  prompt?: string;
  echo: boolean;
}

export interface SshForwardInfo {
  id: string;
  sessionId: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: string;
  error?: string;
}

export interface SftpEntry {
  path: string;
  name: string;
  kind: "dir" | "file";
  sizeBytes: number;
  mtime: number;
}

export interface SftpReadText {
  path: string;
  content: string;
  offset: number;
  bytesRead: number;
  sizeBytes: number;
  truncated: boolean;
  entry: SftpEntry;
}

/** 写回结果;conflict 携带远端当前条目供编辑器弹覆盖确认。 */
export type SftpWriteOutcome =
  | { action: "written"; entry: SftpEntry }
  | { action: "conflict"; entry: SftpEntry | null };

export interface SftpTransferState {
  id: string;
  sessionId: string;
  direction: "upload" | "download";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  sourcePath: string;
  targetPath: string;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  error?: string;
}

/** `ssh://sftp` 载荷:传输进度/终态事件。 */
export interface SftpEventPayload {
  kind: string;
  transfer: SftpTransferState;
}



