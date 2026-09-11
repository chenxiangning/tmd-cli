/**
 * WSL 路径翻译与 spawn 包装契约测试(kernel/wsl.ts)。
 *
 * spawn 命令形状是承重契约:发行版名/--cd 目标/bash -lc 内层引用任何一处
 * 走形,WSL 会话就起错目录或起错命令。UNC 解析覆盖两种历史前缀形态、
 * 尾斜杠、根路径;shellQuote 覆盖单引号注入面。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  ipc: {
    configHomeDir: vi.fn(async () => "C:\\Users\\chen"),
  },
}));

import { parseWslUnc, shellQuote, wslToUnc, wrapWslSpec } from "./wsl";

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

describe("wslToUnc", () => {
  it("posix → UNC 往返一致(根路径无尾段)", () => {
    expect(wslToUnc("Ubuntu-24.04", "/home/chen/work")).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\chen\\work",
    );
    expect(wslToUnc("Ubuntu-24.04", "/")).toBe("\\\\wsl.localhost\\Ubuntu-24.04");
    expect(parseWslUnc(wslToUnc("U", "/a/b"))).toEqual({ distro: "U", linuxPath: "/a/b" });
  });
});

describe("shellQuote", () => {
  it("内部单引号按 '\\'' 规则转义", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("plain")).toBe("'plain'");
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
