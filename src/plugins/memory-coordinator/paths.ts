/**
 * 跨平台路径解析 —— Magic Context 相关的用户级路径唯一来源。
 *
 * 实证(PoC 报告):三平台路径同为 home 相对(POSIX 风格,win 也是),
 * 由上游 getMagicContextStorageResolution 决定;tmd-cli 不硬编码机器路径,
 * home 经 `node -p os.homedir()` 实取(进程 env 可靠,无剥层猜测 —— 曾因
 * configHomeDir 剥层拼接导致「文件不存在」误报)。
 */

import { ipc } from "@kernel/ipc";

let homePromise: Promise<string> | null = null;

/** 用户 home 目录(node 子进程实取,进程级缓存;失败回退空串由调用方提示)。 */
export function userHome(): Promise<string> {
  if (!homePromise) {
    homePromise = ipc
      .procCommunicate({
        command: "node",
        args: ["-p", "require('os').homedir()"],
        cwd: ".",
        timeoutMs: 8_000,
      })
      .then((r) => (r.code === 0 ? r.stdout.trim() : ""))
      .catch(() => "");
  }
  return homePromise;
}

/** 共享记忆库(上游默认解析路径)。 */
export async function memoryDbPath(): Promise<string> {
  return `${await userHome()}/.local/share/cortexkit/magic-context/context.db`;
}

/** 共享配置(magic-context.jsonc)。 */
export async function engineConfigPath(): Promise<string> {
  return `${await userHome()}/.config/cortexkit/magic-context.jsonc`;
}

/** omp 侧插件 dist(bootstrap 迁移的 import 目标;未装时不存在,调用方探测)。 */
export async function pluginDistDir(): Promise<string> {
  return `${await userHome()}/.omp/plugins/node_modules/@cortexkit/pi-magic-context/dist`;
}
