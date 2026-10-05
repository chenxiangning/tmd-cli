/**
 * 语言服务器发现链 —— 插件侧语言知识(spec:惰性自动)。
 *
 * TS5/TS7 分叉(2026-09-19 探活实证):TS7(tsgo 原生包)无
 * lib/tsserverlibrary.js,typescript-language-server 对其直接报错;
 * 此时走 tsgo LSP(--lsp --stdio,裸 --lsp 会因非 stdio 传输退出)。
 * npx 形式注意 bin 名 ≠ 包名须 -p(pyright / @typescript/native-preview)。
 */

import { ipc } from "@kernel/ipc";
import { hashStableString } from "@kernel/textHash";
import { normalizePath } from "@kernel/pathUtils";
import type { LspServerLaunch } from "@kernel/lsp/lspRegistry";

/** 文件存在性探测:读 1 字节成功即可读。 */
async function readable(path: string): Promise<boolean> {
  try {
    await ipc.fsReadHead(path, 1);
    return true;
  } catch {
    return false;
  }
}

/** PATH 探测(cli_probe 与 PTY 同源解析);found 才有 path。 */
async function onPath(command: string): Promise<boolean> {
  const probe = await ipc.cliProbe(command).catch(() => null);
  return probe?.found === true;
}

const isWin = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

function binExt(): string {
  return isWin ? ".cmd" : "";
}

/** TS/JS:工作区 typescript 形态分叉 → TLS(TS5)或 tsgo(TS7/无)。 */
export async function discoverTypeScript(root: string): Promise<LspServerLaunch | null> {
  const tslibOk = await readable(`${root}/node_modules/typescript/lib/tsserverlibrary.js`);
  if (tslibOk) {
    const local = `${root}/node_modules/.bin/typescript-language-server${binExt()}`;
    if (await readable(local)) return { command: local, args: ["--stdio"], label: "TS(TLS)" };
    if (await onPath("typescript-language-server"))
      return { command: "typescript-language-server", args: ["--stdio"], label: "TLS" };
    return {
      command: "npx",
      args: ["-y", "typescript-language-server", "--stdio"],
      label: "TLS(npx)",
    };
  }
  const localTsgo = `${root}/node_modules/.bin/tsgo${binExt()}`;
  if (await readable(localTsgo)) return { command: localTsgo, args: ["--lsp", "--stdio"], label: "TS(tsgo)" };
  return {
    command: "npx",
    args: ["-y", "-p", "@typescript/native-preview", "tsgo", "--lsp", "--stdio"],
    label: "tsgo(npx)",
  };
}

/** Python:venv → PATH → npx -p pyright。 */
export async function discoverPython(root: string): Promise<LspServerLaunch | null> {
  const venvBins = isWin
    ? [`${root}/.venv/Scripts/pyright-langserver.exe`, `${root}/venv/Scripts/pyright-langserver.exe`]
    : [`${root}/.venv/bin/pyright-langserver`, `${root}/venv/bin/pyright-langserver`];
  for (const bin of venvBins) {
    if (await readable(bin)) return { command: bin, args: ["--stdio"], label: "pyright(venv)" };
  }
  if (await onPath("pyright-langserver"))
    return { command: "pyright-langserver", args: ["--stdio"], label: "pyright" };
  return {
    command: "npx",
    args: ["-y", "-p", "pyright", "pyright-langserver", "--stdio"],
    label: "pyright(npx)",
  };
}

/** java 安装描述(installed.json 由 javaInstall 写入)。 */
export interface JdtInstall {
  launcherJar: string;
  configDir: string;
}

/* ── jdt 数据目录隔离 ──
 * 同一 -data 目录的两个 jdt.ls 实例会互等 workspace 锁,后到者永久静默 ——
 * initialize 永不应答,前端 60s 超时后只剩失败 toast(2026-10-03 实证:
 * 安装版与 dev 版并行、同 app 开两个 java 工作区都会踩)。数据目录按
 * 「app 实例 × 工作区根」双键隔离,陈旧实例目录由 pid 存活探测回收。 */

/** app pid(模块缓存;进程生命周期内恒定)。 */
let appPidCache: Promise<number> | null = null;
function appPid(): Promise<number> {
  appPidCache ??= ipc.appPid();
  return appPidCache;
}

/** 测试接缝:清 pid 缓存(用例间换假 pid 用)。 */
export function __resetDiscoveryCacheForTest(): void {
  appPidCache = null;
}

/** jdt 数据目录名:app-<pid>-<root hash>;同实例同工作区跨 idle 关停复用。 */
function jdtDataDirName(pid: number, workspaceRoot: string): string {
  return `app-${pid}-${hashStableString(normalizePath(workspaceRoot))}`;
}

/** 陈旧实例目录回收:pid 已死的 app-<pid>-* 整树移除(best-effort,不挡发现)。
 *  存活探测失败按「活」处理(保守面:宁可留垃圾不误删活实例目录)。 */
async function pruneStaleJdtDataDirs(home: string, alivePid: number): Promise<void> {
  try {
    const entries = await ipc.fsListDir(`${home}/lsp/jdt-ws`);
    await Promise.all(
      entries.map(async (entry) => {
        const m = /^app-(\d+)-/.exec(entry.name);
        if (!m) return; // 旧版共享目录等非实例形态:不动
        const pid = Number(m[1]);
        if (pid === alivePid) return;
        const alive = await ipc.processAlive(pid).catch(() => true);
        if (alive) return;
        void ipc.fsRemovePath(entry.path).catch(() => undefined);
      }),
    );
  } catch {
    /* jdt-ws 不存在/读失败:无陈旧可清 */
  }
}

/** Java:已安装(jdt 目录 installed.json)才有 launch;否则 null 走引导。 */
export async function discoverJava(workspaceRoot: string): Promise<LspServerLaunch | null> {
  const home = await ipc.configDir().catch(() => null);
  if (!home) return null;
  const marker = `${home}/lsp/jdt/installed.json`;
  try {
    const raw = await ipc.fsReadFile(marker);
    const parsed = JSON.parse(raw) as Partial<JdtInstall>;
    if (typeof parsed.launcherJar !== "string" || typeof parsed.configDir !== "string") return null;
    const pid = await appPid().catch(() => 0);
    void pruneStaleJdtDataDirs(home, pid);
    return {
      command: "java",
      args: [
        "-jar",
        parsed.launcherJar,
        "-configuration",
        parsed.configDir,
        "-data",
        `${home}/lsp/jdt-ws/${jdtDataDirName(pid, workspaceRoot)}`,
      ],
      label: "jdt.ls",
    };
  } catch {
    return null;
  }
}

/** java 根目录:向上找 pom.xml / build.gradle / .project 最近祖先,兜底工作区根。 */
export async function resolveJavaRoot(
  filePath: string,
  workspaceRoot: string,
): Promise<string> {
  const markers = ["pom.xml", "build.gradle", "build.gradle.kts", ".project"];
  let dir = filePath.slice(0, filePath.lastIndexOf("/"));
  const floor = workspaceRoot.replace(/\/$/, "");
  for (;;) {
    for (const m of markers) {
      if (await readable(`${dir}/${m}`)) return dir;
    }
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (dir === floor || parent.length <= floor.length || parent === "") return workspaceRoot;
    dir = parent;
  }
}

/** JDK ≥17 探测(java -version 走 stderr)。返回 null = 无 java。 */
export async function javaMajorVersion(): Promise<number | null> {
  const res = await ipc
    .procCommunicate({
      command: "java",
      args: ["-version"],
      cwd: ".",
      closeStdin: true,
      timeoutMs: 8000,
    })
    .catch(() => null);
  const m = /version "(\d+)/.exec(`${res?.stderr ?? ""}${res?.stdout ?? ""}`);
  return m ? Number(m[1]) : null;
}
