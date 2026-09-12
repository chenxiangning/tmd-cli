/**
 * WSL 插件内核 —— 路径翻译 / spawn 包装 / 远程会话命令 / 探针缓存 / 文件 URI。
 * (2026-09-12 插件边界收敛:自 kernel/wsl.ts 迁回,WSL 语义不出本插件目录;
 *  经 kernel/ptyAdapters、fileSources、workspaceOrigins 三个注册表向宿主贡献。)
 *
 * 设计(原型 docs/prototypes/wsl-1-connect.html 同构):WSL 工作区的 root 直接
 * 存 UNC 路径(`\\wsl.localhost\<distro>\<posix路径>`),Workspace 模型零改动 ——
 * UNC 自含发行版名与 Linux 路径,Windows 侧 fs 读写链(std::fs)原生支持。
 * spawn 进 WSL = 在 Windows 侧起 `wsl.exe -d <distro> --cd <linuxCwd> -- …`
 * 包装,PTY 幕布零分叉;远程宿主形态 = ssh 会话 PTY 内首命令(见
 * wslRemoteSpawnCommand),两类都只在本插件装配。
 *
 * 类型契约(WslInfo/WslDistro)在 ipc.ts(与全部 IPC 契约同处)。
 */

import { ipc } from "@kernel/ipc";
import type { SpawnSpec } from "@kernel/ipc";
import type { Workspace } from "@kernel/workspace";
/** UNC 前缀两种历史形态都认:`\\wsl.localhost\<d>` (Win11) 与 `\\wsl$\<d>`。 */
const WSL_UNC_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(?:\\(.*))?$/i;

export interface WslUnc {
  distro: string;
  /** posix 绝对路径(无尾斜杠;根 = "/")。 */
  linuxPath: string;
}

/** 解析 WSL UNC 路径;非 WSL 路径返回 null。 */
export function parseWslUnc(p: string): WslUnc | null {
  const m = WSL_UNC_RE.exec(p.trim());
  if (!m) return null;
  const rest = (m[2] ?? "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const linuxPath = rest ? "/" + rest.replace(/^\/+|\/+$/g, "") : "/";
  return { distro: m[1], linuxPath };
}

/** Linux 绝对路径 → 该发行版的 UNC 路径(P1 目录浏览器拼子节点用)。 */
export function wslToUnc(distro: string, linuxPath: string): string {
  return `\\\\wsl.localhost\\${distro}${linuxPath === "/" ? "" : linuxPath.replace(/\/+$/, "").replace(/\//g, "\\")}`;
}

/** bash 单引号安全引用(内部 `'` → `'\''`)。 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 把 Windows 侧 spec 的 cwd 换成有效目录(wsl.exe 进程自身的 cwd)。
 *  UNC cwd 在发行版停止时 CreateProcess 会失败,故包装后 cwd 落 Windows home。 */
async function windowsCwdFallback(): Promise<string> {
  try {
    return await ipc.configHomeDir();
  } catch {
    return "."; // 纯浏览器 dev 桩环境兜底(不可能真 spawn)
  }
}

/**
 * WSL 工作区 spawn 统一包装:cwd 是 UNC → 改写为 wsl.exe 登录 shell 执行
 * `<command> <args…>`;非 WSL spec 原样返回。sessionSpawn/shellSessions 共用。
 * env 透传给 wsl.exe(Windows 侧),WSL 默认会把 Windows 环境变量带入 Linux,
 * 精确控制(WSLENV)留 P2。
 */
export async function wrapWslSpec(spec: SpawnSpec): Promise<SpawnSpec> {
  const wsl = parseWslUnc(spec.cwd);
  if (!wsl) return spec;
  const inner = [spec.command, ...spec.args].map(shellQuote).join(" ");
  return {
    ...spec,
    command: "wsl.exe",
    args: ["-d", wsl.distro, "--cd", wsl.linuxPath, "--", "bash", "-lc", inner],
    cwd: await windowsCwdFallback(),
  };
}

/** WSL 工作区的内置终端 spec:直落该目录的交互式 bash(不经 bash -lc 二次包装)。 */
export async function wslShellSpec(distro: string, linuxCwd: string, title: string): Promise<SpawnSpec> {
  return {
    command: "wsl.exe",
    args: ["-d", distro, "--cd", linuxCwd, "-e", "bash", "-il"],
    cwd: await windowsCwdFallback(),
    kind: "shell",
    title,
  };
}

/* —— 引擎探针缓存(会话内;运行期插入的 distro 键,Map 语义)——
   DistroPanel 探测成功后写入,侧栏新建会话菜单按 distro 过滤引擎行。 */
const probeCache = new Map<string, string[]>();

/** 记录某发行版检出的引擎 bin 集合(探针成功后调用)。 */
export function rememberWslProbes(distro: string, bins: string[]): void {
  probeCache.set(distro, bins);
}

/** 取某发行版检出的引擎 bin 集合;未探测过返回 null(消费方按「不过滤」处理)。 */
export function getWslProbedBins(distro: string): string[] | null {
  return probeCache.get(distro) ?? null;
}

/**
 * 远程 WSL 会话命令串:作为 ssh_session_create 的初始命令在 Windows 宿主上执行。
 * 宿主 DefaultShell 会先解析一层(实证可能是 PowerShell)—— 发行版名/路径用双引号
 * 包裹(PS 单引号在这里不能用于 wsl.exe 参数层;发行版名不含 `"` 与 `$`,路径是
 * WSL 内部路径不含 PS 插值面)。opts.cd = 会话起始目录;opts.engine = 指定引擎
 * (bash -lc 登录 shell 解析其 PATH);都缺省 = 发行版默认 shell(交互)。
 */
export function wslRemoteSpawnCommand(
  distro: string,
  opts?: { cd?: string; engine?: string },
): string {
  const d = distro.trim();
  const cd = opts?.cd?.trim();
  const engine = opts?.engine?.trim();
  let cmd = `wsl.exe -d "${d}"`;
  if (cd) cmd += ` --cd "${cd}"`;
  if (engine) cmd += ` -- bash -lc ${shellQuote(engine)}`;
  return cmd;
}

/* —— 来源与文件 URI(2026-09-12 自 workspace/files 插件收拢)—— */

/** 工作区来源 id(settings.workspaceOriginFilter 持久化值)。 */
export const WSL_ORIGIN_ID = "wsl";

/** 来源判定:WSL 工作区(显式元数据,或 Windows 本机 UNC 形态)。 */
export function isWslWorkspace(ws: Workspace): boolean {
  return !!ws.wsl || ws.root.startsWith("\\\\wsl.localhost\\\\");
}

/** 远程 WSL 文件 URI 前缀(wslr://<hostId>/<distro>/<linuxPath>)。 */
export const WSLR_SCHEME = "wslr://";

/** 远程文本读取上限(与本地 fs 文本读取闸同量级)。 */
export const REMOTE_WSL_FILE_MAX_BYTES = 512 * 1024;

export interface RemoteWslFileRef {
  hostId: string;
  distro: string;
  linuxPath: string;
}

/** 是否远程 WSL 文件 URI。 */
export function isRemoteWslFile(path: string): boolean {
  return path.startsWith(WSLR_SCHEME);
}

/** 解析 wslr:// URI;形态不合法返回 null(linuxPath 有 Rust 白名单字符集背书)。 */
export function parseRemoteWslFile(path: string): RemoteWslFileRef | null {
  if (!isRemoteWslFile(path)) return null;
  const rest = path.slice(WSLR_SCHEME.length);
  const hostEnd = rest.indexOf("/");
  if (hostEnd <= 0) return null;
  const distroStart = hostEnd + 1;
  const distroEnd = rest.indexOf("/", distroStart);
  if (distroEnd <= distroStart) return null;
  const hostId = rest.slice(0, hostEnd);
  const distro = rest.slice(distroStart, distroEnd);
  const linuxPath = rest.slice(distroEnd + 1);
  if (!linuxPath) return null;
  return { hostId, distro, linuxPath };
}

/** 组装 wslr:// URI(文件树点击 / 打开入口共用)。 */
export function remoteWslFileUri(hostId: string, distro: string, linuxPath: string): string {
  return `${WSLR_SCHEME}${hostId}/${distro}/${linuxPath}`;
}
