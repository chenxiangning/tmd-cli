/**
 * DSH 连接配置域(无 UI):连接归一/持久化 + BrowserAuth 凭据头。
 * 0.1.2 起 host 全部 RPC/WS 需要 BrowserAuth 签名 cookie —— 凭据链:
 * 面板拉起 host 时抓 PTY 输出的一次性 launch token 换 cookie 落盘
 * (进程域在 dshHost.ts);适配器经 --cookie 直用。
 */

export const DSH_CONNECTION_KEY = "tmd.dsh.connection.v1";

export interface DshConnection {
  host: string;
  port: number;
  /** 自定义 dsh 可执行路径(绝对路径或 PATH 内名字);空串 = 用 PATH 的 dsh。 */
  customBin: string;
  /** 自动启动主机:进首页且 host 未运行时拉起;拨开关不立刻启停。 */
  autoStart: boolean;
  /** BrowserAuth 签名 cookie(dsh-auth-*,authority 绑定);0.1.2 起全部 RPC/WS 必带。 */
  cookie?: string;
  /** host 进程一次性 launch token(Web UI 外开入口用);host 重启即换。 */
  launchToken?: string;
}

export const DEFAULT_CONNECTION: DshConnection = {
  host: "127.0.0.1",
  port: 3080,
  customBin: "",
  autoStart: true,
};

export function loadConnection(): DshConnection {
  try {
    const raw = localStorage.getItem(DSH_CONNECTION_KEY);
    if (!raw) return { ...DEFAULT_CONNECTION };
    const parsed = JSON.parse(raw) as Partial<DshConnection>;
    return {
      host: typeof parsed.host === "string" && parsed.host ? parsed.host : DEFAULT_CONNECTION.host,
      port: typeof parsed.port === "number" && parsed.port > 0 ? parsed.port : DEFAULT_CONNECTION.port,
      customBin: typeof parsed.customBin === "string" ? parsed.customBin : DEFAULT_CONNECTION.customBin,
      autoStart: typeof parsed.autoStart === "boolean" ? parsed.autoStart : DEFAULT_CONNECTION.autoStart,
      cookie: typeof parsed.cookie === "string" ? parsed.cookie : undefined,
      launchToken: typeof parsed.launchToken === "string" ? parsed.launchToken : undefined,
    };
  } catch {
    return { ...DEFAULT_CONNECTION };
  }
}

export function saveConnection(conn: DshConnection): void {
  localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify(conn));
}

/** 归一 host/port(空 host 回默认,端口截 1-65535);origin 变更即弃凭据(cookie
 *  按 host:port authority 签名绑定,换 origin 必失效)。 */
export function normalizeConnection(
  host: string,
  port: string,
  base: DshConnection = DEFAULT_CONNECTION,
): DshConnection {
  const trimmed = host.trim();
  const parsed = Number.parseInt(port, 10);
  const nextHost = trimmed || DEFAULT_CONNECTION.host;
  const nextPort = Number.isFinite(parsed) ? Math.min(65535, Math.max(1, parsed)) : DEFAULT_CONNECTION.port;
  const originChanged = nextHost !== base.host || nextPort !== base.port;
  return {
    ...base,
    host: nextHost,
    port: nextPort,
    ...(originChanged ? { cookie: undefined, launchToken: undefined } : {}),
  };
}

/** 启动命令:自定义路径优先,回退 PATH 里的 dsh。 */
export function dshCommand(conn: DshConnection): string {
  return conn.customBin.trim() || "dsh";
}

export function originOf(conn: DshConnection): string {
  return `http://${conn.host}:${conn.port}`;
}

/** RPC/WS 鉴权头;conn 快照缺 cookie 时回读最新落盘(host 拉起后凭据后到)。 */
export function authHeaders(conn: DshConnection): Record<string, string> {
  const cookie = conn.cookie || loadConnection().cookie;
  return cookie ? { cookie } : {};
}

/** 打开 Web UI 的入口 URL:有 launch token 才能过 BrowserAuth 门禁。 */
export function webUiUrl(conn: DshConnection): string {
  return conn.launchToken
    ? `${originOf(conn)}/?token=${encodeURIComponent(conn.launchToken)}`
    : originOf(conn);
}

/** 仅本机 origin 允许停止;远程地址绝不代杀(codemoss is_local_host 同款)。 */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0";
}
