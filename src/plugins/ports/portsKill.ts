/**
 * ports · kill 语义 —— unix 二段杀(SIGTERM → 1.5s 存活探测 → SIGKILL),
 * Windows taskkill /T 杀树(dev server 包装层一并收);命令形状导出供复制与单测。
 */

import { ipc } from "@kernel/ipc";
import type { OsKind } from "./types";

const TERM_GRACE_MS = 1500;

/** 可贴进任意终端复用的终止命令。 */
export function killCommand(pid: number, os: OsKind): string {
  return os === "windows" ? `taskkill /F /T /PID ${pid}` : `kill -9 ${pid}`;
}

async function runKill(command: string, args: string[], timeoutMs = 4000): Promise<void> {
  const r = await ipc.procCommunicate({ command, args, cwd: "/", timeoutMs, closeStdin: true });
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || `${command} exited with code ${r.code}`);
  }
}

/** 终止监听进程;返回实际使用的信号级("term" = SIGTERM 即退,"killed" = 已强杀/杀树)。 */
export async function killListener(pid: number, os: OsKind): Promise<"term" | "killed"> {
  if (os === "windows") {
    await runKill("taskkill", ["/F", "/T", "/PID", String(pid)], 8000);
    return "killed";
  }
  await runKill("kill", ["-TERM", String(pid)]);
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, TERM_GRACE_MS);
  await promise;
  if (!(await ipc.processAlive(pid).catch(() => false))) return "term";
  await runKill("kill", ["-9", String(pid)]);
  return "killed";
}
