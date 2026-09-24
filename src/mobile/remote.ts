/**
 * 手机远程数据层 —— 手机 UI 与桌面之间唯一的耦合点 = kernel/transport 的 RPC 面。
 * 原则(大仙拍板):手机 = 远程控制器,只经 RPC 操作桌面;本模块不 import 任何
 * 桌面 UI/host,也不提供任何「手机本地执行」语义。
 * 可用命令全部在 AppDevice 白名单内(web/conn.rs app_allowed)。
 */

import { shellLog } from "@kernel/shellBridge";

export interface RemoteSession {
  id: string;
  /** 服务端 SessionMeta serde camelCase;手机 UI 一律以线上形状为准 */
  profileId: string;
  cwd: string;
  workspaceId?: string;
  createdAt?: number;
  kind?: "cli" | "ssh" | "shell";
  /** CLI 磁盘身份(注册表直读:桥 resume 直填 / 桌面绑定镜像;缺省 = 未绑定)。 */
  cliSessionId?: string;
}

export interface RemoteWorkspace {
  id: string;
  name: string;
  root: string;
}

/** 引擎字形(与桌面侧栏 glyph 同映射;profileId 前缀 → 缩写 + 品牌色类)。 */
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

/** 桌面 settings 三覆盖层一次 RPC 全取(评审:三次独立 config_read_settings =
 *  全树 settings.json ×3;titles key = profileId:cliSessionId,archive/pins key =
 *  wsId:profileId:cliSessionId,语义 kernel/sessionArchive.ts / sessionPins.ts)。 */
export async function overlayState(): Promise<{
  titles: Record<string, string>;
  archive: Set<string>;
  pins: Record<string, { title?: string; pinnedAt?: number }>;
}> {
  const s = await invokeSafe<Record<string, Record<string, unknown>>>("config_read_settings");
  const obj = <T>(v: unknown): Record<string, T> =>
    v && typeof v === "object" ? (v as Record<string, T>) : {};
  return {
    titles: obj<string>(s?.sessionTitles),
    archive: new Set(Object.keys(obj(s?.sessionArchive))),
    pins: obj<{ title?: string; pinnedAt?: number }>(s?.sessionPins),
  };
}

/** 置顶切换(服务端读改写仅 sessionPins 键,免手机持全量快照;返回切换后状态)。 */
export async function sessionPinToggle(key: string, title: string): Promise<boolean> {
  const r = await invokeSafe<{ pinned: boolean }>("session_pin_toggle", { key, title });
  return r.pinned;
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

/** 轻量 ask 检测:活流尾窗命中【通用】标记表(ASK_MARKER_RE)即视为等待确认。
 *  刻意子集(契约评审 face4 注):不含 profile 私有 askMarks、无 1.2s 候选确认与
 *  写后 8s 抑制;漏报私有卡片型 CLI、作答后残影可能瞬时复燃重弹卡(下帧自愈)。 */
export async function tailHasAskMarker(tail: string): Promise<boolean> {
  const { ASK_MARKER_RE, stripAnsi } = await import("@kernel/askDetect");
  const lines = stripAnsi(tail).split("\n").slice(-5).join("\n");
  ASK_MARKER_RE.lastIndex = 0;
  return ASK_MARKER_RE.test(lines);
}

/** 尾窗内命中 ask 标记的原文行(ask 卡正文;提示行常在选项区上方数行,窗口放宽到 40 行)。 */
export async function tailAskLine(tail: string): Promise<string | null> {
  // 动态 import:askDetect 与 transport 同策略切出主 chunk(手机入口体积),非运行时选型
  const { ASK_MARKER_RE, stripAnsi } = await import("@kernel/askDetect");
  const lines = stripAnsi(tail).split("\n").slice(-40);
  for (let i = lines.length - 1; i >= 0; i--) {
    ASK_MARKER_RE.lastIndex = 0;
    if (ASK_MARKER_RE.test(lines[i])) return lines[i].trim();
  }
  return null;
}

// ---- 基础 invoke(远程模式;未连接时抛错由调用方处理) ----

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@kernel/transport");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // 设备侧诊断:失败命令+错误进 shell.log(真机排查唯一现场)
    shellLog(`rpc ${cmd} 失败: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    throw e;
  }
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
