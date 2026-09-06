/**
 * 安装编排的检测面 —— 全部经 proc_communicate,跨平台(node/npm.exe 直跑)。
 *
 * PoC 实证(报告「迁移窗口要求」):上游交互向导会中途落盘不回滚,编排走
 * 非交互组合:`omp plugin install` + 手写 jsonc + 直改 config.yml。
 */

import { ipc } from "@kernel/ipc";

export interface NodeEnv {
  available: boolean;
  version: string;
  /** 上游引擎声明 ≥24;22 可跑(node:sqlite 实验特性)但记风险。 */
  meetsUpstreamRequirement: boolean;
}

/** node 可用性与版本(退出码非 0 / 超时 → 不可用)。 */
export async function detectNode(): Promise<NodeEnv> {
  try {
    const r = await ipc.procCommunicate({
      command: "node",
      args: ["-v"],
      cwd: ".",
      timeoutMs: 10_000,
    });
    const version = r.stdout.trim().replace(/^v/, "");
    if (r.code !== 0 || !version) return { available: false, version: "", meetsUpstreamRequirement: false };
    const major = Number(version.split(".")[0]);
    return { available: true, version, meetsUpstreamRequirement: major >= 24 };
  } catch {
    return { available: false, version: "", meetsUpstreamRequirement: false };
  }
}

/** omp 插件清单是否已含 pi-magic-context(omp plugin list 文本判定)。 */
export async function detectOmpPluginInstalled(): Promise<boolean> {
  try {
    const r = await ipc.procCommunicate({
      command: "omp",
      args: ["plugin", "list"],
      cwd: ".",
      timeoutMs: 20_000,
    });
    return r.code === 0 && r.stdout.includes("@cortexkit/pi-magic-context");
  } catch {
    return false;
  }
}

/** pi 侧插件已装(~/.pi/agent/npm/node_modules 下,安装目录形态 PoC 实证)。 */
export async function detectPiInstalled(piHome: string): Promise<boolean> {
  try {
    const pkg = await ipc.procCommunicate({
      command: "node",
      args: ["-e", `console.log(require('fs').existsSync(${JSON.stringify(piHome + "/npm/node_modules/@cortexkit/pi-magic-context/package.json")}))`],
      cwd: ".",
      timeoutMs: 8_000,
    });
    return rOk(pkg);
  } catch {
    return false;
  }
}

/** opencode 侧插件已装(其配置 plugin 数组含 @cortexkit/opencode-magic-context)。 */
export function detectOpencodeInstalled(configText: string): boolean {
  return configText.includes("@cortexkit/opencode-magic-context");
}

function rOk(r: { code: number | null; stdout: string }): boolean {
  return r.code === 0 && r.stdout.trim() === "true";
}

/** 共享库就绪判定:文件存在 + schema_migrations 可读(PoC:锁住时 0 字节无表)。 */
export async function detectSharedDbReady(dbPath: string): Promise<boolean> {
  try {
    const rows = await ipc.sqliteQuery(
      dbPath,
      "SELECT count(*) FROM sqlite_master WHERE type='table'",
      [],
    );
    return Number(rows[0]?.[0] ?? 0) > 0;
  } catch {
    return false;
  }
}
