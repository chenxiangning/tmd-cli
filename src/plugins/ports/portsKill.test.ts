/**
 * ports · kill 链单测 —— 身份快照/比对纯函数与平台命令拼装;killListener 走桩 ipc。
 * vi.mock 会提升到静态 import 之前,桩替换与静态导入不冲突。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { identityProbe, identityState, killListener, readIdentity } from "./portsKill";
import type { ProcRunResult } from "@kernel/ipc";

const invokeCalls: Array<{ cmd: string; args: unknown }> = [];
let invokeImpl: (cmd: string, args: unknown) => Promise<unknown> = async () => ({});

vi.mock("@kernel/ipc", () => ({
  ipc: {
    procCommunicate: (spec: { command: string; args?: unknown }) => {
      invokeCalls.push({ cmd: "procCommunicate", args: spec });
      return invokeImpl("procCommunicate", spec);
    },
    processAlive: (pid: number) => {
      invokeCalls.push({ cmd: "processAlive", args: pid });
      return invokeImpl("processAlive", pid);
    },
  },
}));

type Os = "mac" | "linux" | "windows";

/** 从记录的 procCommunicate 调用里取命令形状(in 守卫收窄,不做形状断言)。 */
function killCalls(): Array<{ command: string; args: string[] }> {
  const out: Array<{ command: string; args: string[] }> = [];
  for (const c of invokeCalls) {
    if (c.cmd !== "procCommunicate") continue;
    const spec = c.args;
    if (spec && typeof spec === "object" && "command" in spec && "args" in spec) {
      out.push({ command: String(spec.command), args: (spec.args as string[]) ?? [] });
    }
  }
  return out;
}

function okProc(stdout = ""): ProcRunResult {
  return { stdout, stderr: "", code: 0, timedOut: false };
}

afterEach(() => {
  invokeCalls.length = 0;
  invokeImpl = async () => ({});
  vi.restoreAllMocks();
});

describe("identityProbe 平台命令拼装", () => {
  it("unix 用 ps -o lstart= 取启动时刻", () => {
    expect(identityProbe("mac", 4321)).toEqual({ command: "ps", args: ["-p", "4321", "-o", "lstart="] });
    expect(identityProbe("linux", 4321)).toEqual({ command: "ps", args: ["-p", "4321", "-o", "lstart="] });
  });

  it("windows 用 PowerShell 取 StartTime ISO 串", () => {
    const p = identityProbe("windows", 99);
    expect(p.command).toBe("powershell");
    expect(p.args[0]).toBe("-NoProfile");
    expect(p.args[1]).toBe("-Command");
    expect(p.args[2]).toContain("Get-Process -Id 99");
    expect(p.args[2]).toContain("StartTime");
  });
});

describe("identityState 三态", () => {
  it("快照一致 = same", () => {
    expect(identityState("Mon Oct 20 10:00:00 2026", "Mon Oct 20 10:00:00 2026")).toBe("same");
  });

  it("启动时刻变了 = reused(pid 复用)", () => {
    expect(identityState("Mon Oct 20 10:00:00 2026", "Thu Oct 23 09:30:00 2026")).toBe("reused");
  });

  it("任一侧查不到 = unknown(查询失败)", () => {
    expect(identityState(null, "Mon Oct 20 10:00:00 2026")).toBe("unknown");
    expect(identityState("Mon Oct 20 10:00:00 2026", null)).toBe("unknown");
    expect(identityState(null, null)).toBe("unknown");
  });
});

describe("readIdentity", () => {
  it("code 0 且有输出 = 身份串(trim)", () => {
    invokeImpl = async () => okProc("Mon Oct 20 10:00:00 2026\n");
    return expect(readIdentity(1, "mac")).resolves.toBe("Mon Oct 20 10:00:00 2026");
  });

  it("code 非 0 / 输出空 / 抛错 = null", async () => {
    invokeImpl = async (_cmd, args) => {
      const spec = args as { command: string; args?: unknown };
      return spec.command === "ps" ? { stdout: "", stderr: "no such process", code: 1 } : Promise.reject(new Error("ipc down"));
    };
    await expect(readIdentity(1, "mac")).resolves.toBeNull();
  });
});

describe("killListener unix 二段杀 + 身份重验", () => {
  it("SIGTERM 即退 = term(不补杀,快照只查一次)", async () => {
    invokeImpl = async (cmd) => (cmd === "processAlive" ? false : okProc("start-7"));
    await expect(killListener(7, "mac")).resolves.toBe("term");
    expect(invokeCalls.filter((c) => c.cmd === "processAlive")).toHaveLength(1);
    expect(killCalls().filter((k) => k.command === "ps")).toHaveLength(1);
  });

  it("存活且身份一致 = killed(补 SIGKILL)", async () => {
    invokeImpl = async (cmd, args) => {
      if (cmd === "processAlive") return true;
      const spec = args as { command: string; args?: unknown };
      if (spec.command === "ps") return okProc("Mon Oct 20 10:00:00 2026");
      return okProc();
    };
    await expect(killListener(7, "mac")).resolves.toBe("killed");
    const sigkill = killCalls().find((k) => k.command === "kill" && k.args[0] === "-9");
    expect(sigkill?.args[1]).toBe("7");
  });

  it("存活但身份不符 = reused(跳过强杀,不发 -9)", async () => {
    let psCount = 0;
    invokeImpl = async (cmd, args) => {
      if (cmd === "processAlive") return true;
      const spec = args as { command: string; args?: unknown };
      if (spec.command === "ps") return okProc(`snapshot-${++psCount}`);
      return okProc();
    };
    await expect(killListener(7, "mac")).resolves.toBe("reused");
    expect(killCalls().some((k) => k.command === "kill" && k.args[0] === "-9")).toBe(false);
  });

  it("补杀前查询失败(unknown)= 回落旧行为补 SIGKILL", async () => {
    invokeImpl = async (cmd, args) => {
      if (cmd === "processAlive") return true;
      const spec = args as { command: string; args?: unknown };
      return spec.command === "ps" ? { stdout: "", stderr: "boom", code: 1 } : okProc();
    };
    await expect(killListener(7, "mac")).resolves.toBe("killed");
  });

  it("SIGTERM 命令失败直接抛错", async () => {
    invokeImpl = async () => ({ stdout: "", stderr: "operation not permitted", code: 1 });
    await expect(killListener(7, "mac")).rejects.toThrow("operation not permitted");
  });

  it("宽限等待真实流逝(1.5s)", async () => {
    invokeImpl = async (cmd) => (cmd === "processAlive" ? false : okProc("start-7"));
    const t0 = Date.now();
    await killListener(7, "mac");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
  });
});

describe("killListener windows", () => {
  it("taskkill /F /T 杀树 = killed", async () => {
    invokeImpl = async () => okProc();
    await expect(killListener(9, "windows")).resolves.toBe("killed");
    const only = killCalls();
    expect(only).toHaveLength(1);
    expect(only[0].command).toBe("taskkill");
    expect(only[0].args).toEqual(["/F", "/T", "/PID", "9"]);
  });
});

describe("OsKind 全平台覆盖类型冒烟", () => {
  it("identityProbe 三平台返回形状齐备", () => {
    for (const os of ["mac", "linux", "windows"] as const satisfies readonly Os[]) {
      const p = identityProbe(os, 1);
      expect(typeof p.command).toBe("string");
      expect(Array.isArray(p.args)).toBe(true);
    }
  });
});
