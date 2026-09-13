/**
 * WSL 路径翻译与 spawn 包装契约测试(plugins/wsl/wslCore.ts)。
 *
 * spawn 命令形状是承重契约:发行版名/--cd 目标/bash -lc 内层引用任何一处
 * 走形,WSL 会话就起错目录或起错命令。UNC 解析覆盖两种历史前缀形态、
 * 尾斜杠、根路径;shellQuote 覆盖单引号注入面。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: vi.fn(async () => "C:\\Users\\chen"),
  },
}));

import {
  isWslWorkspace,
  parseWslUnc,
  shellQuote,
  wslRemoteSpawnCommand,
  wslToUnc,
  wrapWslSpec,
  wslWorkspaceTargetOk,
} from "./wslCore";

describe("parseWslUnc", () => {
  it("认 wsl.localhost 与 wsl$ 两种前缀,反斜杠转 posix", () => {
    expect(parseWslUnc("\\\\wsl.localhost\\Ubuntu-24.04\\home\\chen\\work\\ml")).toEqual({
      distro: "Ubuntu-24.04",
      linuxPath: "/home/chen/work/ml",
    });
    expect(parseWslUnc("\\\\wsl$\\Debian\\tmp\\x")?.linuxPath).toBe("/tmp/x");
  });
  it("发行版根 = /;尾斜杠与重复分隔符折叠", () => {
    expect(parseWslUnc("\\\\wsl.localhost\\Ubuntu")?.linuxPath).toBe("/");
    expect(parseWslUnc("\\\\wsl.localhost\\Ubuntu\\a\\\\b\\")?.linuxPath).toBe("/a/b");
  });
  it("非 WSL 路径返回 null(本地盘/mac 路径/相对路径)", () => {
    expect(parseWslUnc("D:\\work\\proj-api")).toBeNull();
    expect(parseWslUnc("/Users/x/proj")).toBeNull();
    expect(parseWslUnc("\\\\server\\share\\x")).toBeNull();
  });
});

describe("wslWorkspaceTargetOk", () => {
  it("本机分支只收绝对路径:`~/cxn` 曾被直喂 wslToUnc 拼出 `Ubuntu~` 假发行版毒根(WSL_E_DISTRO_NOT_FOUND 实证)", () => {
    expect(wslWorkspaceTargetOk("/home/cxn/work", false)).toBe(true);
    expect(wslWorkspaceTargetOk("~/cxn", false)).toBe(false);
    expect(wslWorkspaceTargetOk("~", false)).toBe(false);
    expect(wslWorkspaceTargetOk("/", false)).toBe(false);
    expect(wslWorkspaceTargetOk("home/cxn", false)).toBe(false);
  });
  it("远程分支保留 `~` 波浪惯例(契约 09 铁律 2),只拦裸 `~` 与空", () => {
    expect(wslWorkspaceTargetOk("~/work", true)).toBe(true);
    expect(wslWorkspaceTargetOk("/home/cxn", true)).toBe(true);
    expect(wslWorkspaceTargetOk("~", true)).toBe(false);
    expect(wslWorkspaceTargetOk("", true)).toBe(false);
  });
});

describe("wslToUnc", () => {
  it("posix → UNC 往返一致(根路径无尾段)", () => {
    expect(wslToUnc("Ubuntu-24.04", "/home/chen/work")).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\chen\\work",
    );
    expect(wslToUnc("Ubuntu-24.04", "/")).toBe("\\\\wsl.localhost\\Ubuntu-24.04");
    expect(parseWslUnc(wslToUnc("U", "/a/b"))).toEqual({ distro: "U", linuxPath: "/a/b" });
  });
});

describe("isWslWorkspace", () => {
  it("无 meta 的规范 UNC root 也认(兜底前缀曾是双尾反斜杠,永不匹配的死子句)", () => {
    expect(isWslWorkspace({ id: "w", name: "w", root: "\\\\wsl.localhost\\Ubuntu\\home", createdAt: 0 })).toBe(true);
    expect(isWslWorkspace({ id: "w", name: "w", root: "\\\\wsl.localhost\\Ubuntu~\\cxn", createdAt: 0 })).toBe(true);
    expect(isWslWorkspace({ id: "w", name: "w", root: "C:\\work", createdAt: 0 })).toBe(false);
  });
});

describe("shellQuote", () => {
  it("内部单引号按 '\\'' 规则转义", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("plain")).toBe("'plain'");
  });
});

describe("wslRemoteSpawnCommand", () => {
  it("发行版名双引号包裹并去空白(宿主 DefaultShell 可能是 PowerShell,防带空格名碎参)", () => {
    expect(wslRemoteSpawnCommand("Ubuntu")).toBe('wsl.exe -d "Ubuntu"');
    expect(wslRemoteSpawnCommand(" My Distro ")).toBe('wsl.exe -d "My Distro"');
  });
  it("cd 与 engine 叠加:engine 经 bash -lc 单引号引用", () => {
    expect(wslRemoteSpawnCommand("Ubuntu", { cd: "/home/cxn/work" })).toBe(
      'wsl.exe -d "Ubuntu" --cd "/home/cxn/work"',
    );
    expect(wslRemoteSpawnCommand("Ubuntu", { cd: "/w", engine: "claude" })).toBe(
      "wsl.exe -d \"Ubuntu\" --cd \"/w\" -- bash -lc 'claude'",
    );
  });
});

describe("wrapWslSpec", () => {
  it("UNC cwd → wsl.exe 包装:内层命令逐参引用,wsl.exe 自身 cwd 落 Windows home", async () => {
    const out = await wrapWslSpec({
      command: "claude",
      args: ["--resume", "8f2d1c43"],
      cwd: "\\\\wsl.localhost\\Ubuntu-24.04\\home\\chen\\work\\ml",
    });
    expect(out.command).toBe("wsl.exe");
    expect(out.args).toEqual([
      "-d",
      "Ubuntu-24.04",
      "--cd",
      "/home/chen/work/ml",
      "--",
      "bash",
      "-lc",
      "'claude' '--resume' '8f2d1c43'",
    ]);
    expect(out.cwd).toBe("C:\\Users\\chen");
  });
  it("非 WSL spec 原样返回(本地工作区零影响)", async () => {
    const spec = { command: "claude", args: [], cwd: "/Users/x/proj" };
    expect(await wrapWslSpec(spec)).toBe(spec);
  });
});
