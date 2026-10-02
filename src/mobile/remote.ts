/**
 * 手机远程数据层 —— 手机 UI 与桌面之间唯一的耦合点 = kernel/transport 的 RPC 面。
 * 原则(大仙拍板):手机 = 远程控制器,只经 RPC 操作桌面;本模块不 import 任何
 * 桌面 UI/host,也不提供任何「手机本地执行」语义。
 * 可用命令全部在 AppDevice 白名单内(web/conn.rs app_allowed)。
 */

import { shellInvoke, shellLog } from "@kernel/shellBridge";
import { invoke, listen } from "@kernel/transport";
import { formatRelativeTime } from "@kernel/relativeTime";

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
  /** 桌面活动守望投影(session_list 直读;缺省 = 空闲)。「运行中」区成员判定 =
   *  activity.turnActive || activity.unread,与桌面 RunningZone 的 isRunningZoneCandidate 同律。 */
  activity?: { turnActive?: boolean; unread?: boolean } | null;
}

export interface RemoteWorkspace {
  id: string;
  name: string;
  root: string;
}

/** 引擎字形回落:已知引擎全由 engineGlyphOf(cli-shared)品牌 SVG 覆盖
 *  (EngineMark 先查),此处只兜未知 profileId 的两字母缩写。 */
export function glyphOf(profileId: string): { text: string; cls: string } {
  const p = profileId.toLowerCase();
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

/** 会话屏「续聊」(退出横幅钮):活会话元数据直走 resumeDiskSession(引擎
 *  resumeArgs 冷开 / 日志指针聚焦活 PTY);无磁盘身份(未落盘新会话)= null
 *  不可续。动态 import:resume 与 askDetect 同策略切出主 chunk(手机入口体积)。 */
export async function resumeExitedSession(
  meta: RemoteSession,
  sessions: RemoteSession[],
): Promise<string | null> {
  if (!meta.cliSessionId || !meta.cwd) return null;
  const { resumeDiskSession } = await import("./resume");
  return resumeDiskSession({
    profileId: meta.profileId,
    cwd: meta.cwd,
    cliSessionId: meta.cliSessionId,
    workspaceId: meta.workspaceId,
    sessions,
  });
}

// ---- 基础 invoke(远程模式;未连接时抛错由调用方处理) ----

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // 设备侧诊断:失败命令+错误进 shell.log(真机排查唯一现场)
    shellLog(`rpc ${cmd} 失败: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    throw e;
  }
}

/** 桥帧预算:手机 invoke 帧 ≤3.5MiB(transportBridge 守卫),JSON 数字数组
 *  每字节 ~3.6 字符 → 字节上限留余量取 900KB(1568/q0.8 的噪点照片可超 1MB)。 */
const UPLOAD_BYTE_BUDGET = 900_000;

/** base64 → JPEG Blob(native pickImage 回传还原;独立纯函数供单测)。 */
export function blobFromB64(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

/** 选图结果分流:cancelled → null(用户取消);缺 b64 → throw(原因上屏);
 *  有 b64 → JPEG Blob。 */
export function pickResultToBlob(r: { b64?: string; cancelled?: boolean }): Blob | null {
  if (r.cancelled) return null;
  if (!r.b64) throw new Error(`pickImage 回传无图片数据: ${JSON.stringify(r).slice(0, 80)}`);
  return blobFromB64(r.b64);
}

/** 选图:native PHPicker 直连(ShellBridge "pickImage"),不经 <input type=file>
 *  —— WKUIDelegate 文件面板是 iOS 18.4+ 面,低版本 input 是静默死钮(真机实测)。
 *  取消 → null;失败 → throw(由 attachShot flashErr 上屏)。 */
export async function pickShotImage(): Promise<Blob | null> {
  return pickResultToBlob(await shellInvoke<{ b64: string; cancelled?: boolean }>("pickImage"));
}

/** 图像压到长边 ≤maxEdge 的 JPEG(微信级),且压进桥帧预算(超预算逐级
 *  降质量/缩边重编码,防拍照路径确定性撞 3.5MiB 守卫)。 */
export async function shrinkImage(blob: Blob, maxEdge = 1568): Promise<Uint8Array<ArrayBuffer>> {
  let bitmap: ImageBitmap;
  try {
    /* from-image:按 EXIF 方向转正(竖拍);旧引擎不认该选项则裸开。 */
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  try {
    const encode = async (edge: number, quality: number): Promise<Uint8Array<ArrayBuffer>> => {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
      if (!blob) throw new Error("encode failed");
      return new Uint8Array(await blob.arrayBuffer());
    };
    for (const [edge, quality] of [
      [maxEdge, 0.8],
      [maxEdge, 0.6],
      [1280, 0.6],
      [960, 0.5],
    ] as const) {
      const bytes = await encode(edge, quality);
      if (bytes.length <= UPLOAD_BYTE_BUDGET) return bytes;
    }
    throw new Error("image too large after shrink");
  } finally {
    /* WKWebView 原生位图内存等 major GC 才回收,连续挂图可感:显式关。 */
    bitmap.close();
  }
}

/** 截图/拍照 → 桥 fs_write_temp 落盘会话临时文件,返回绝对路径(composer @ 注入用)。 */
export function uploadTempImage(name: string, bytes: Uint8Array): Promise<string> {
  return invokeSafe<string>("fs_write_temp", { name, data: Array.from(bytes) });
}

/** 选图(pickImage 直连;file 参数 = 测试注入)→ 压缩(压进桥帧预算)→
 *  fs_write_temp 落盘 → onShot 挂 composer 预览(objectURL 随移除/发送释放)。
 *  草稿不再注入 @路径(长路径挤占输入框):发送时统一拼(composeSendText)。
 *  取消/失败走 shell.log 且按钮 3s 变 ✕(手机屏上唯一可见反馈)。 */
export async function attachShot(
  o: {
    isBusy: boolean;
    setBusy: (v: boolean) => void;
    onShot: (shot: { path: string; url: string }) => void;
    flashErr: (v: boolean) => void;
  },
  file?: Blob,
): Promise<void> {
  if (o.isBusy) return;
  o.setBusy(true);
  try {
    const blob = file ?? (await pickShotImage());
    if (!blob) return; /* 用户取消:静默 */
    const bytes = await shrinkImage(blob);
    const path = await uploadTempImage(`shot-${Date.now()}.jpg`, bytes);
    o.onShot({ path, url: URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })) });
  } catch (e) {
    shellLog(`上传截图失败: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    o.flashErr(true);
    window.setTimeout(() => o.flashErr(false), 3000);
  } finally {
    o.setBusy(false);
  }
}

/** 发送文本 = 草稿正文 + 已挂图片 @路径(桌面附件同语义);两者皆空 → null 不发。 */
export function composeSendText(text: string, paths: string[]): string | null {
  const body = text.trimEnd();
  if (!body && !paths.length) return null;
  return [body, ...paths.map((p) => `@${p}`)].filter(Boolean).join(" ");
}


/** 相对时间(home 行 meta)—— 实现引 @kernel/relativeTime 全仓唯一版本
 *  (2026-09-29 四源收敛:本地手写「N 秒/N 分」版已删,口径 = 刚刚/N 分钟前/…
 *  与桌面 git 历史/checkpoints/session 列表同源);空值显示 —。 */
export function relTime(ts?: number): string {
  return ts ? formatRelativeTime(ts) : "—";
}
