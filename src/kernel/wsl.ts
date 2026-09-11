/**
 * WSL 路径与 spawn 包装 —— 内核纯函数层(2026-09-11 WSL 支持 P1)。
 *
 * 设计(原型 docs/prototypes/wsl-1-connect.html 同构):WSL 工作区的 root 直接
 * 存 UNC 路径(`\\wsl.localhost\<distro>\<posix路径>`),Workspace 模型零改动 ——
 * UNC 自含发行版名与 Linux 路径,fs 读写链(std::fs)原生支持。
 * spawn 进 WSL = 在 Windows 侧起 `wsl.exe -d <distro> --cd <linuxCwd> -- …`
 * 包装(先例:cli-dsh spawnTransform 的适配器改写),PTY 幕布零分叉。
 *
 * 类型契约(WslInfo/WslDistro)在 ipc.ts(与全部 IPC 契约同处);本文件只留
 * 纯函数与包装。
 */

import { ipc } from "./ipc";
import type { SpawnSpec } from "./ipc";
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

/** 在 WSL 内跑一条一次性 shell 命令(探针/盘点用)。返回 stdout(UTF-8 透传)。 */
export async function wslExec(
  distro: string,
  shCommand: string,
  timeoutMs = 8000,
): Promise<{ ok: boolean; stdout: string; code: number | null }> {
  const res = await ipc.procCommunicate({
    command: "wsl.exe",
    args: ["-d", distro, "-e", "sh", "-c", shCommand],
    cwd: await windowsCwdFallback(),
    closeStdin: true, // 一次性命令:等 EOF 不关会挂到超时(2026-09-06 d 路实证)
    timeoutMs,
  });
  return { ok: !res.timedOut && res.code === 0, stdout: res.stdout, code: res.code };
}
