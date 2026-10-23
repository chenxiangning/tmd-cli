/**
 * ports · kill 语义 —— unix 二段杀(SIGTERM → 1.5s 宽限 → 身份重验 → SIGKILL),
 * Windows taskkill /T 杀树(dev server 包装层一并收);命令形状导出供复制与单测。
 * 身份重验:补杀前比对进程启动时刻,防宽限窗内 pid 复用误杀无辜新进程。
 */

import { ipc } from "@kernel/ipc";
import type { OsKind } from "./types";

const TERM_GRACE_MS = 1500;

/** 补杀结果:"term" = SIGTERM 即退,"killed" = 已强杀/杀树,"reused" = pid 复用,跳过强杀。 */
export type KillOutcome = "term" | "killed" | "reused";

/** 可贴进任意终端复用的终止命令。 */
export function killCommand(pid: number, os: OsKind): string {
  return os === "windows" ? `taskkill /F /T /PID ${pid}` : `kill -9 ${pid}`;
}

/** 进程身份快照命令(按平台取进程启动时刻;unix = ps lstart,Windows = PowerShell StartTime)。 */
export function identityProbe(os: OsKind, pid: number): { command: string; args: string[] } {
  if (os === "windows") {
    return {
      command: "powershell",
      args: ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).StartTime.ToString('o')`],
    };
  }
  return { command: "ps", args: ["-p", String(pid), "-o", "lstart="] };
}

/** 读身份快照;进程已不存在(code 非 0 或输出空)或查询失败回 null。 */
export async function readIdentity(pid: number, os: OsKind): Promise<string | null> {
  const { command, args } = identityProbe(os, pid);
  const r = await ipc
    .procCommunicate({ command, args, cwd: "/", timeoutMs: 3000, closeStdin: true })
    .catch(() => null);
  if (!r || r.code !== 0) return null;
  const id = r.stdout.trim();
  return id ? id : null;
}

/** 身份比对纯函数:same = 快照一致可补杀;reused = 启动时刻变了(pid 复用);unknown = 任一侧查不到。 */
export function identityState(before: string | null, after: string | null): "same" | "reused" | "unknown" {
  if (before === null || after === null) return "unknown";
  return before === after ? "same" : "reused";
}

async function runKill(command: string, args: string[], timeoutMs = 4000): Promise<void> {
  const r = await ipc.procCommunicate({ command, args, cwd: "/", timeoutMs, closeStdin: true });
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || `${command} exited with code ${r.code}`);
  }
}

/** 终止监听进程;返回实际使用的信号级(见 KillOutcome)。 */
export async function killListener(pid: number, os: OsKind): Promise<KillOutcome> {
  if (os === "windows") {
    await runKill("taskkill", ["/F", "/T", "/PID", String(pid)], 8000);
    return "killed";
  }
  const before = await readIdentity(pid, os);
  await runKill("kill", ["-TERM", String(pid)]);
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, TERM_GRACE_MS);
  await promise;
  if (!(await ipc.processAlive(pid).catch(() => false))) return "term";
  /* ponytail: 快照侧查询失败(before=null)时无法比对,回落旧行为直接补杀;
   * 若要更保守可在 unknown 态也跳过强杀,代价是僵尸监听只能靠用户手动 kill。 */
  const state = identityState(before, await readIdentity(pid, os));
  if (state === "reused") return "reused";
  await runKill("kill", ["-9", String(pid)]);
  return "killed";
}
