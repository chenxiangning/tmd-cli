/**
 * write.ts d 路 v2 单元测试 —— 断言 viaOmp 拼出正确的 subagent 启动参数。
 *
 * 关键契约(PoC-7 实证,见 docs/review/2026-09-06-d-path-flag-fix.md §2):
 * - omp/pi 必须传 `--extension <subagentEntry> --magic-context-dreamer-actions --tools ctx_memory --no-session`
 * - opencode 走 `opencode run`,且插件未装时预检早退(missing-plugin)
 * - subagentEntry 缺失时 viaOmp 早退,detail 含 missing-subagent-entry
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as paths from "../paths";
import { ipc } from "@kernel/ipc";
import {
  buildSubagentArgs,
  rememberFacts,
  archiveMemory,
  mergeMemories,
  distillSessionTail,
} from "./write";

const SUBAGENT = "/fake/path/subagent-entry.js";

vi.mock("../paths", () => ({
  resolveSubagentEntry: vi.fn(async () => SUBAGENT),
  isOpencodeMagicContextInstalled: vi.fn(async () => true),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    procCommunicate: vi.fn(async () => ({
      stdout: "已写入 1 条",
      stderr: "",
      code: 0,
      timedOut: false,
    })),
  },
}));

const proc = vi.mocked(ipc.procCommunicate);

beforeEach(() => {
  proc.mockClear();
  proc.mockResolvedValue({
    stdout: "已写入 1 条",
    stderr: "",
    code: 0,
    timedOut: false,
  });
  vi.mocked(paths.resolveSubagentEntry).mockResolvedValue(SUBAGENT);
  vi.mocked(paths.isOpencodeMagicContextInstalled).mockResolvedValue(true);
});

function lastCall() {
  const calls = proc.mock.calls;
  return calls[calls.length - 1]?.[0] as {
    command: string;
    args: string[];
    cwd: string;
    closeStdin?: boolean;
    timeoutMs: number;
  };
}

describe("buildSubagentArgs(omp/pi d 路 v2)", () => {
  it("必含 --extension + subagentEntry + --magic-context-dreamer-actions + --tools ctx_memory + --no-session + -p instruction", () => {
    const args = buildSubagentArgs({
      instruction: "调 ctx_memory write",
      subagentEntry: SUBAGENT,
    });
    expect(args[args.indexOf("--extension") + 1]).toBe(SUBAGENT);
    expect(args).toContain("--magic-context-dreamer-actions");
    expect(args[args.indexOf("--tools") + 1]).toBe("ctx_memory");
    expect(args).toContain("--no-session");
    expect(args[args.indexOf("-p") + 1]).toBe("调 ctx_memory write");
  });

  it("传 model 时插在 -p 之前", () => {
    const args = buildSubagentArgs({
      model: "kimi-code/k3",
      instruction: "调工具",
      subagentEntry: SUBAGENT,
    });
    const modelIdx = args.indexOf("--model");
    const pIdx = args.indexOf("-p");
    expect(args[modelIdx + 1]).toBe("kimi-code/k3");
    expect(modelIdx).toBeLessThan(pIdx);
  });

  it("无 model 时不出现 --model", () => {
    const args = buildSubagentArgs({ instruction: "x", subagentEntry: SUBAGENT });
    expect(args).not.toContain("--model");
  });
});

describe("viaOmp 实际调用形态", () => {
  it("rememberFacts 走 omp 时 args 包含 subagent 扩展参数", async () => {
    await rememberFacts([{ category: "CONSTRAINTS", content: "测试" }], "/cwd");
    const call = lastCall();
    expect(call.command).toBe("omp");
    expect(call.args).toContain(SUBAGENT);
    expect(call.args).toContain("--magic-context-dreamer-actions");
    expect(call.args).toContain("ctx_memory");
    expect(call.cwd).toBe("/cwd");
    expect(call.timeoutMs).toBe(120_000);
    expect(call.closeStdin).toBe(true);
  });

  it("engine=pi 走 pi 子进程,同样带 subagent 参数", async () => {
    await rememberFacts([{ category: "X", content: "y" }], "/cwd", { engine: "pi" });
    const call = lastCall();
    expect(call.command).toBe("pi");
    expect(call.args).toContain(SUBAGENT);
    expect(call.args).toContain("--magic-context-dreamer-actions");
  });

  it("engine=opencode 走 opencode run(已装插件时不带 subagent 参数)", async () => {
    await rememberFacts([{ category: "X", content: "y" }], "/cwd", { engine: "opencode" });
    const call = lastCall();
    expect(call.args).not.toContain("--magic-context-dreamer-actions");
    expect(call.closeStdin).toBe(true);
    expect(call.command).toBe("opencode");
    expect(call.args[0]).toBe("run");
    expect(call.args).not.toContain("--magic-context-dreamer-actions");
  });

  it("engine=opencode 且插件未装时预检早退(missing-plugin)", async () => {
    vi.mocked(paths.isOpencodeMagicContextInstalled).mockResolvedValueOnce(false);
    const out = await rememberFacts([{ category: "X", content: "y" }], "/cwd", { engine: "opencode" });
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("missing-plugin");
    expect(proc).not.toHaveBeenCalled();
  });

  it("archive / merge / distill 同样走 subagent args", async () => {
    await archiveMemory(1, "/cwd");
    expect(lastCall().args).toContain("--magic-context-dreamer-actions");

    await mergeMemories([1, 2], "merged", "/cwd");
    expect(lastCall().args).toContain("--magic-context-dreamer-actions");

    await distillSessionTail("用户消息尾段", "/cwd");
    expect(lastCall().args).toContain("--magic-context-dreamer-actions");
  });

  it("subagent 缺失时 viaOmp 早退,detail 含 missing-subagent-entry", async () => {
    vi.mocked(paths.resolveSubagentEntry).mockResolvedValueOnce(null);
    const out = await rememberFacts([{ category: "X", content: "y" }], "/cwd");
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("missing-subagent-entry");
    expect(proc).not.toHaveBeenCalled();
  });

  it("退出非 0 时 ok=false,detail 含 stderr", async () => {
    proc.mockResolvedValueOnce({
      stdout: "",
      stderr: "fatal: no extension",
      code: 1,
      timedOut: false,
    });
    const out = await rememberFacts([{ category: "X", content: "y" }], "/cwd");
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("fatal: no extension");
  });
});
