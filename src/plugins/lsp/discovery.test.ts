/** 发现链测试 —— mock ipc 后验证 TS5/TS7 分叉、python 链序、java 安装描述与根上溯、
 * jdt 数据目录的实例隔离与陈旧回收。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readablePaths = new Set<string>();
const pathCommands = new Set<string>();
let configFile = "";
let fakePid = 4321;
let alivePids = new Set<number>();
const removedPaths: string[] = [];
let jdtWsEntries: Array<{ name: string; path: string; isDir: boolean }> = [];

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsReadHead: async (path: string) => {
      if (!readablePaths.has(path)) throw new Error("missing");
      return "x";
    },
    cliProbe: async (command: string) => ({ command, found: pathCommands.has(command) }),
    fsReadFile: async (path: string) => {
      if (path === "/home/.tmd-cli/lsp/jdt/installed.json" && configFile) return configFile;
      throw new Error("missing");
    },
    configDir: async () => "/home/.tmd-cli",
    appPid: async () => fakePid,
    processAlive: async (pid: number) => alivePids.has(pid),
    fsListDir: async () => jdtWsEntries,
    fsRemovePath: async (path: string) => {
      removedPaths.push(path);
    },
  },
}));

import {
  __resetDiscoveryCacheForTest,
  discoverJava,
  discoverPython,
  discoverTypeScript,
  resolveJavaRoot,
} from "./discovery";

beforeEach(() => {
  readablePaths.clear();
  pathCommands.clear();
  configFile = "";
  fakePid = 4321;
  alivePids = new Set();
  removedPaths.length = 0;
  jdtWsEntries = [];
  __resetDiscoveryCacheForTest();
});

describe("discoverTypeScript(TS5/TS7 分叉)", () => {
  it("TS5 工作区:本地 TLS 优先", async () => {
    readablePaths.add("/w/node_modules/typescript/lib/tsserverlibrary.js");
    readablePaths.add("/w/node_modules/.bin/typescript-language-server");
    const launch = await discoverTypeScript("/w");
    expect(launch?.command).toBe("/w/node_modules/.bin/typescript-language-server");
    expect(launch?.args).toEqual(["--stdio"]);
  });

  it("TS5 无本地但有全局:走 PATH", async () => {
    readablePaths.add("/w/node_modules/typescript/lib/tsserverlibrary.js");
    pathCommands.add("typescript-language-server");
    const launch = await discoverTypeScript("/w");
    expect(launch?.command).toBe("typescript-language-server");
  });

  it("TS7(tsgo 包无 tsserverlibrary):npx tsgo 且 --stdio 必带", async () => {
    const launch = await discoverTypeScript("/w");
    expect(launch?.command).toBe("npx");
    expect(launch?.args).toEqual(["-y", "-p", "@typescript/native-preview", "tsgo", "--lsp", "--stdio"]);
  });

  it("TS7 但工作区自装 tsgo:本地优先", async () => {
    readablePaths.add("/w/node_modules/.bin/tsgo");
    const launch = await discoverTypeScript("/w");
    expect(launch?.command).toBe("/w/node_modules/.bin/tsgo");
    expect(launch?.args).toEqual(["--lsp", "--stdio"]);
  });
});

describe("discoverPython", () => {
  it("venv 优先于 PATH", async () => {
    readablePaths.add("/w/.venv/bin/pyright-langserver");
    pathCommands.add("pyright-langserver");
    const launch = await discoverPython("/w");
    expect(launch?.command).toBe("/w/.venv/bin/pyright-langserver");
  });

  it("无发现时 npx -p 形式(bin 名 ≠ 包名)", async () => {
    const launch = await discoverPython("/w");
    expect(launch?.args).toEqual(["-y", "-p", "pyright", "pyright-langserver", "--stdio"]);
  });
});

describe("discoverJava / resolveJavaRoot", () => {
  it("未安装返回 null;installed.json 提供 launch(数据目录含实例隔离键)", async () => {
    expect(await discoverJava("/w")).toBeNull();
    configFile = JSON.stringify({ launcherJar: "/jdt/plugins/launcher_1.jar", configDir: "/jdt/config_mac" });
    const launch = await discoverJava("/w");
    expect(launch?.command).toBe("java");
    const dataArg = launch?.args[launch.args.indexOf("-data") + 1];
    expect(dataArg).toMatch(/^\/home\/\.tmd-cli\/lsp\/jdt-ws\/app-4321-/);
  });

  it("同实例不同工作区 → 不同数据目录;不同实例(不同 pid)亦不同;同键重发现稳定", async () => {
    configFile = JSON.stringify({ launcherJar: "/jdt/j.jar", configDir: "/jdt/c" });
    const a = await discoverJava("/wsA");
    fakePid = 9999;
    __resetDiscoveryCacheForTest(); // 换假 pid 须清 pid 缓存(进程内本就恒定)
    const b = await discoverJava("/wsA");
    const c = await discoverJava("/wsB");
    const dataOf = (l: { args: readonly string[] }) => l.args[l.args.indexOf("-data") + 1];
    expect(dataOf(a!)).not.toBe(dataOf(b!)); // 跨实例(安装版+dev 并行)不互等锁
    expect(dataOf(b!)).not.toBe(dataOf(c!)); // 同实例双 java 工作区不互等锁
    fakePid = 4321;
    __resetDiscoveryCacheForTest();
    const again = await discoverJava("/wsA"); // 同 pid 同根重发现:目录稳定(idle 关停后复用缓存)
    expect(dataOf(again!)).toBe(dataOf(a!));
  });

  it("陈旧实例目录回收:死 pid 的 app-<pid>-* 移除,活 pid 与旧版共享目录不动", async () => {
    configFile = JSON.stringify({ launcherJar: "/jdt/j.jar", configDir: "/jdt/c" });
    jdtWsEntries = [
      { name: "app-100-old", path: "/home/.tmd-cli/lsp/jdt-ws/app-100-old", isDir: true },
      { name: "app-4321-mine", path: "/home/.tmd-cli/lsp/jdt-ws/app-4321-mine", isDir: true },
      { name: "jdt.ls-java-project", path: "/home/.tmd-cli/lsp/jdt-ws/jdt.ls-java-project", isDir: true },
    ];
    alivePids = new Set([4321]); // 只有自己活;100 已死
    await discoverJava("/w");
    await new Promise((r) => setTimeout(r, 0)); // prune 是 fire-and-forget
    expect(removedPaths).toEqual(["/home/.tmd-cli/lsp/jdt-ws/app-100-old"]);
  });

  it("根目录向上找 pom.xml 最近祖先,兜底工作区根", async () => {
    readablePaths.add("/w/sub/pom.xml");
    expect(await resolveJavaRoot("/w/sub/src/A.java", "/w")).toBe("/w/sub");
    expect(await resolveJavaRoot("/w/other/B.java", "/w")).toBe("/w");
  });
});
