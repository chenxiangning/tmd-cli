/**
 * 用户 home 目录(Rust dirs::home_dir 实取,进程级缓存)。
 * memory-coordinator/paths.ts 同款先例:不走 `node -p os.homedir()`,
 * 全新机器 node 可能未装;ipc.configHomeDir 名字带 config 实返回 home。
 */

import { ipc } from "@kernel/ipc";

let homePromise: Promise<string> | null = null;

export function userHome(): Promise<string> {
  if (!homePromise) {
    homePromise = ipc.configHomeDir().catch(() => "");
  }
  return homePromise;
}
