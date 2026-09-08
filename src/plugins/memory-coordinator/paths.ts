/**
 * 跨平台路径解析 —— Magic Context 相关的用户级路径唯一来源。
 *
 * 实证(PoC 报告):三平台路径同为 home 相对(POSIX 风格,win 也是),
 * 由上游 getMagicContextStorageResolution 决定;tmd-cli 不硬编码机器路径。
 * home 经 ipc.configHomeDir() 实取(Rust dirs::home_dir,进程级缓存):
 * 曾走 `node -p os.homedir()`,但全新机器 node 可能未装,整条记忆链会在
 * 首启时静默失效回退空串(2026-09-06 win 新装机实证);Rust 侧无此依赖。
 */

import { ipc } from "@kernel/ipc";

let homePromise: Promise<string> | null = null;

/** 用户 home 目录(Rust dirs::home_dir 实取,进程级缓存;失败回退空串由调用方提示)。 */
export function userHome(): Promise<string> {
  if (!homePromise) {
    homePromise = ipc.configHomeDir().catch(() => "");
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

/** magic-context 插件的 subagent 入口(相对插件根;omp / pi 各自安装根下同名同文件)。 */
const SUBAGENT_ENTRY_RELPATH = "@cortexkit/pi-magic-context/dist/subagent-entry.js";

/** opencode 配置文件候选(检测 @cortexkit/opencode-magic-context 是否注册)。 */
const OPENCODE_CONFIG_CANDIDATES = [
  "~/.config/opencode/opencode.json",
  "~/.config/opencode/opencode.jsonc",
  "~/.config/opencode/oh-my-opencode.json",
  "~/.config/opencode/oh-my-opencode.jsonc",
];

/**
 * 解析 subagent-entry.js 绝对路径(d 路 v2)。
 *
 * 不写死单一引擎:omp / pi 的插件安装根不同(~/.omp/plugins vs ~/.pi/agent/npm),
 * 但 dist 是同一份(subagent-entry 运行时经 resolvePiHarnessKind 自适应宿主),
 * 故按候选探测、命中即用;env `TMD_MAGIC_CONTEXT_SUBAGENT_ENTRY` 最高优先。
 * 渲染层禁 node 内建 —— 探测在 node 子进程内完成(同 detect.ts 先例)。
 */
export async function resolveSubagentEntry(): Promise<string | null> {
  const override = typeof process !== "undefined" ? process.env?.TMD_MAGIC_CONTEXT_SUBAGENT_ENTRY?.trim() : undefined;
  const candidates = override
    ? [override]
    : [
        `~/.omp/plugins/node_modules/${SUBAGENT_ENTRY_RELPATH}`,
        `~/.pi/agent/npm/node_modules/${SUBAGENT_ENTRY_RELPATH}`,
      ];
  const script =
    `const fs=require("fs"),os=require("os");` +
    `const hit=JSON.parse(process.argv[1]).map(s=>s.replace(/^~/,os.homedir()))` +
    `.find(s=>{try{return fs.existsSync(s)}catch{return false}});console.log(hit||"")`;
  try {
    const r = await ipc.procCommunicate({
      command: "node",
      args: ["-e", script, JSON.stringify(candidates)],
      cwd: ".",
      timeoutMs: 8_000,
    });
    if (r.code !== 0) return null;
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * opencode 的 magic-context 插件是否已注册(d 路过 opencode 的预检)。
 * 判定同 install/detect.ts detectOpencodeInstalled:配置文本含插件名;文件全缺失 = 未装。
 */
export async function isOpencodeMagicContextInstalled(): Promise<boolean> {
  const script =
    `const fs=require("fs"),os=require("os");` +
    `const hit=JSON.parse(process.argv[1]).map(s=>s.replace(/^~/,os.homedir()))` +
    `.find(s=>{try{return fs.readFileSync(s,"utf8").includes("@cortexkit/opencode-magic-context")}catch{return false}});` +
    `console.log(hit?"true":"false")`;
  try {
    const r = await ipc.procCommunicate({
      command: "node",
      args: ["-e", script, JSON.stringify(OPENCODE_CONFIG_CANDIDATES)],
      cwd: ".",
      timeoutMs: 8_000,
    });
    return r.code === 0 && r.stdout.trim() === "true";
  } catch {
    return false;
  }
}
