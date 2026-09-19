/** 发现链测试 —— mock ipc 后验证 TS5/TS7 分叉、python 链序、java 安装描述与根上溯。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readablePaths = new Set<string>();
const pathCommands = new Set<string>();
let configFile = "";

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
  },
}));

import { discoverJava, discoverPython, discoverTypeScript, resolveJavaRoot } from "./discovery";

beforeEach(() => {
  readablePaths.clear();
  pathCommands.clear();
  configFile = "";
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
  it("未安装返回 null;installed.json 提供 launch", async () => {
    expect(await discoverJava()).toBeNull();
    configFile = JSON.stringify({ launcherJar: "/jdt/plugins/launcher_1.jar", configDir: "/jdt/config_mac" });
    const launch = await discoverJava();
    expect(launch?.command).toBe("java");
    expect(launch?.args).toEqual(["-jar", "/jdt/plugins/launcher_1.jar", "-configuration", "/jdt/config_mac", "-data", "/home/.tmd-cli/lsp/jdt-ws"]);
  });

  it("根目录向上找 pom.xml 最近祖先,兜底工作区根", async () => {
    readablePaths.add("/w/sub/pom.xml");
    expect(await resolveJavaRoot("/w/sub/src/A.java", "/w")).toBe("/w/sub");
    expect(await resolveJavaRoot("/w/other/B.java", "/w")).toBe("/w");
  });
});
