/**
 * 手机远程数据层 —— 手机 UI 与桌面之间唯一的耦合点 = kernel/transport 的 RPC 面。
 * 原则(大仙拍板):手机 = 远程控制器,只经 RPC 操作桌面;本模块不 import 任何
 * 桌面 UI/host,也不提供任何「手机本地执行」语义。
 * 可用命令全部在 AppDevice 白名单内(web/conn.rs app_allowed)。
 */

export interface RemoteSession {
  id: string;
  profile_id: string;
  cwd: string;
  workspace_id?: string;
  created_at?: number;
  kind?: "cli" | "ssh" | "shell";
}

export interface RemoteWorkspace {
  id: string;
  name: string;
  root: string;
}

/** 引擎字形(与桌面侧栏 glyph 同映射;profile_id 前缀 → 缩写 + 品牌色类)。 */
export function glyphOf(profileId: string): { text: string; cls: string } {
  const p = profileId.toLowerCase();
  if (p.startsWith("omp") || p.startsWith("pi")) return { text: "OMP", cls: "g-om" };
  if (p.startsWith("claude")) return { text: "CL", cls: "g-cl" };
  if (p.startsWith("codex")) return { text: "CX", cls: "g-cx" };
  if (p.startsWith("kimi")) return { text: "KI", cls: "g-ki" };
  if (p.startsWith("grok")) return { text: "GK", cls: "g-gk" };
  if (p.startsWith("qoder")) return { text: "QD", cls: "g-qd" };
  if (p.startsWith("opencode")) return { text: "OC", cls: "g-oc" };
  return { text: (p[0] ?? "?").toUpperCase() + (p[1] ?? "").toUpperCase(), cls: "g-df" };
}

export function listSessions(): Promise<RemoteSession[]> {
  return invokeSafe<RemoteSession[]>("session_list");
}

export function listWorkspaces(): Promise<RemoteWorkspace[]> {
  return invokeSafe<{ list: RemoteWorkspace[] }>("config_read_workspaces").then(
    (r) => r?.list ?? [],
  );
}

/** 会话手动命名覆盖层(桌面 settings.sessionTitles,key = 会话 id)。 */
export async function sessionTitles(): Promise<Record<string, string>> {
  const s = await invokeSafe<Record<string, Record<string, string>>>("config_read_settings");
  const t = s?.sessionTitles;
  return t && typeof t === "object" ? t : {};
}

/** 写 PTY:data 原样入流(键应答传 "\r"/"\x1b";消息传 text + "\r")。 */
export function writeSession(id: string, data: string): Promise<void> {
  return invokeSafe<void>("session_write", { id, data }).then(() => undefined);
}

/** 实况活流订阅(payload = 原样字节字符串,含 ANSI)。 */
export async function onPtyOut(
  sessionId: string,
  cb: (chunk: string) => void,
): Promise<() => void> {
  const { listen } = await import("@kernel/transport");
  return listen<string>(`pty://out/${sessionId}`, (e) => cb(String(e.payload ?? "")));
}

/** 轻量 ask 检测:活流尾窗命中标记即视为等待确认(askDetect 同一标记表)。 */
export async function tailHasAskMarker(tail: string): Promise<boolean> {
  const { ASK_MARKER_RE, stripAnsi } = await import("@kernel/askDetect");
  const lines = stripAnsi(tail).split("\n").slice(-5).join("\n");
  ASK_MARKER_RE.lastIndex = 0;
  return ASK_MARKER_RE.test(lines);
}

// ---- 基础 invoke(远程模式;未连接时抛错由调用方处理) ----

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@kernel/transport");
  return invoke<T>(cmd, args);
}

/** 相对时间(home 行 meta;与桌面侧栏口径一致)。 */
export function relTime(ts?: number): string {
  if (!ts) return "—";
  const d = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (d < 60) return `${d} 秒`;
  if (d < 3600) return `${Math.floor(d / 60)} 分`;
  if (d < 86400) return `${Math.floor(d / 3600)} 时`;
  return `${Math.floor(d / 86400)} 天`;
}

/** cwd 末段(会话行的次级标识)。 */
export function baseName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}
