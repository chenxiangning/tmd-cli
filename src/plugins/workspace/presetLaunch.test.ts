/**
 * 会话预设启动编排单测(纯 DI,仿 anim startSession.test):spawn 成功注入
 * pending、失败/空命令零残留、模型旗标按引擎声明追加。
 */
import { describe, expect, it, vi } from "vitest";
import { launchPresetSession, type LaunchPresetInput } from "./presetLaunch";

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
