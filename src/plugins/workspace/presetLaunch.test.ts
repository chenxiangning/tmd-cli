/**
 * 会话预设启动编排单测(纯 DI,仿 anim startSession.test):spawn 成功注入
 * pending、失败/空命令零残留、模型旗标按引擎声明追加。
 */
import { describe, expect, it, vi } from "vitest";
import type { WtCreateOutcome } from "./worktreeCreate";
import {
  launchPresetSession,
  launchPresetWorktreeSession,
  type LaunchPresetInput,
  type LaunchPresetWorktreeInput,
} from "./presetLaunch";

function baseInput(overrides?: Partial<LaunchPresetInput>): LaunchPresetInput {
  return {
    profileId: "claude",
    command: "claude",
    args: ["--flag"],
    env: {},
    cwd: "/ws",
    title: "预设名",
    promptText: "初始提示词",
    deps: {
      spawn: vi.fn(async () => ({ id: "pty-1" })),
      setPendingPrompt: vi.fn(),
    },
    ...overrides,
  };
}

describe("launchPresetSession 两步编排", () => {
  it("spawn 成功 → 注入解析后的提示词并返回 sessionId", async () => {
    const input = baseInput();
    const r = await launchPresetSession(input);
    expect(r).toEqual({ ok: true, sessionId: "pty-1" });
    expect(input.deps.spawn).toHaveBeenCalledWith({
      command: "claude", args: ["--flag"], cwd: "/ws", env: {}, title: "预设名",
    });
    expect(input.deps.setPendingPrompt).toHaveBeenCalledWith("pty-1", "初始提示词");
  });

  it("提示词为空白 = 不注入(无提示词预设合法)", async () => {
    const input = baseInput({ promptText: "   " });
    const r = await launchPresetSession(input);
    expect(r).toEqual({ ok: true, sessionId: "pty-1" });
    expect(input.deps.setPendingPrompt).not.toHaveBeenCalled();
  });

  it("spawn 失败 → start-failed 且不写 pending(失败零残留)", async () => {
    const input = baseInput({ deps: { spawn: vi.fn(async () => { throw new Error("denied"); }), setPendingPrompt: vi.fn() } });
    const r = await launchPresetSession(input);
    expect(r).toEqual({ ok: false, reason: "start-failed" });
    expect(input.deps.setPendingPrompt).not.toHaveBeenCalled();
  });

  it("空 command → no-engine,不触发 spawn(防空 spawn 兜底)", async () => {
    const input = baseInput({ command: "" });
    const r = await launchPresetSession(input);
    expect(r).toEqual({ ok: false, reason: "no-engine" });
    expect(input.deps.spawn).not.toHaveBeenCalled();
  });

  it("model + modelArg 追加进程参数;引擎未声明 modelArg 则忽略 model", async () => {
    const withArg = baseInput({ modelArg: "--model", model: "glm-5" });
    await launchPresetSession(withArg);
    expect(withArg.deps.spawn).toHaveBeenCalledWith(expect.objectContaining({ args: ["--flag", "--model", "glm-5"] }));

    const noArg = baseInput({ model: "glm-5" });
    await launchPresetSession(noArg);
    expect(noArg.deps.spawn).toHaveBeenCalledWith(expect.objectContaining({ args: ["--flag"] }));
  });
});

describe("launchPresetWorktreeSession 一键建树编排", () => {
  function wtInput(overrides?: Partial<LaunchPresetWorktreeInput>): LaunchPresetWorktreeInput {
    return {
      profileId: "omp",
      name: "修 CI",
      workspaceRoot: "/home/u/repo",
      args: ["--flag"],
      env: { A: "1" },
      promptText: "  初始提示词  ",
      deps: {
        gitInfo: vi.fn(async () => ({ takenBranches: [], localBranches: [] })),
        create: vi.fn(async (): Promise<WtCreateOutcome> => ({ ok: true })),
        startFailed: vi.fn(),
      },
      ...overrides,
    };
  }

  it("happy path:分支 = 预设名 slug 加 wt/ 前缀,路径取父目录;prompt 去空白透传", async () => {
    const input = wtInput();
    const r = await launchPresetWorktreeSession(input);
    expect(r).toEqual({ ok: true });
    expect(input.deps.startFailed).not.toHaveBeenCalled();
    expect(input.deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repoCwd: "/home/u/repo",
        finalBranch: "wt/修-CI",
        wtPath: "/home/u/wt-修-CI",
        newBranch: true,
        engineId: "omp",
        title: "修 CI",
        spawnArgs: ["--flag"],
        spawnEnv: { A: "1" },
        promptText: "初始提示词",
      }),
    );
  });

  it("分支冲突:树占用 ∪ 本地分支集中命中 → 自动 -2 递增", async () => {
    const input = wtInput({
      deps: {
        gitInfo: vi.fn(async () => ({ takenBranches: ["wt/修-CI"], localBranches: ["main"] })),
        create: vi.fn(async (): Promise<WtCreateOutcome> => ({ ok: true })),
        startFailed: vi.fn(),
      },
    });
    await launchPresetWorktreeSession(input);
    expect(input.deps.create).toHaveBeenCalledWith(expect.objectContaining({ finalBranch: "wt/修-CI-2" }));
  });

  it("非 git 仓(gitInfo null)→ startFailed 且不建树", async () => {
    const input = wtInput({
      deps: {
        gitInfo: vi.fn(async () => null),
        create: vi.fn(async (): Promise<WtCreateOutcome> => ({ ok: true })),
        startFailed: vi.fn(),
      },
    });
    const r = await launchPresetWorktreeSession(input);
    expect(r).toEqual({ ok: false });
    expect(input.deps.startFailed).toHaveBeenCalledTimes(1);
    expect(input.deps.create).not.toHaveBeenCalled();
  });

  it("建树失败 → startFailed 带结果文案,不静默", async () => {
    const input = wtInput({
      deps: {
        gitInfo: vi.fn(async () => ({ takenBranches: [], localBranches: [] })),
        create: vi.fn(async () => ({ ok: false, kind: "add-failed" as const, msg: "boom" })),
        startFailed: vi.fn(),
      },
    });
    const r = await launchPresetWorktreeSession(input);
    expect(r).toEqual({ ok: false });
    expect(input.deps.startFailed).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("model 组装与 launchPresetSession 同口径(modelArg 缺声明则忽略)", async () => {
    const withArg = wtInput({ modelArg: "--model", model: "glm-5" });
    await launchPresetWorktreeSession(withArg);
    expect(withArg.deps.create).toHaveBeenCalledWith(expect.objectContaining({ spawnArgs: ["--flag", "--model", "glm-5"] }));

    const noArg = wtInput({ model: "glm-5" });
    await launchPresetWorktreeSession(noArg);
    expect(noArg.deps.create).toHaveBeenCalledWith(expect.objectContaining({ spawnArgs: ["--flag"] }));
  });
});
