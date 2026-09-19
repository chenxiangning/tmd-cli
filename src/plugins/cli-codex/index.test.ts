/**
 * codex profile 注册契约测试 —— 钉死 bracketedPaste 阵营。
 *
 * 2026-09-06 PTY 探针实测(见 kernel/cliProfile.ts bracketedPaste 注):codex 启动/恢复窗
 * 与斜杠弹层活跃态,裸「文本+CR」单 chunk 回车被编辑器吞("composer 发了但幕布没
 * 提交");BP 标记后走 handlePaste 通路,CR 照常提交,resume 场景 /model 实测执行。
 * 一旦被摘,composer/模型位点击在 codex 上回归「发了但没回车」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliCodexPlugin } from "./index";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
  fsReadTailChanged: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: mocks,
}));

function activateCapturingProfile(): CliProfile {
  const captured: CliProfile[] = [];
  cliCodexPlugin.activate({
    registerCliProfile: (profile: CliProfile) => captured.push(profile),
    registerTabContent: () => {},
    registerCommand: () => {},
    registerCliConfig: () => {},
  } as unknown as PluginContext);
  const profile = captured[0];
  if (!profile) throw new Error("activate 未注册任何 profile");
  return profile;
}

describe("cli-codex profile 注册契约", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("id 为 codex 且必须声明 bracketedPaste(启动/恢复窗吞回车的修复线)", () => {
    const profile = activateCapturingProfile();
    expect(profile.id).toBe("codex");
    expect(profile.bracketedPaste).toBe(true);
  });

  it("状态巡航尺寸闸:命中拍免列目录免读头(collect/head 仅首拍)", async () => {
    const profile = activateCapturingProfile();
    const HOME = "/home-test";
    const PATH = `${HOME}/.codex/sessions/r-abc123.jsonl`;
    const TAIL = '{"type":"turn","model":"gpt-5.3"}\n';
    mocks.configHomeDir.mockResolvedValue(HOME);
    mocks.fsCollectFiles.mockResolvedValue([
      { name: "r-abc123.jsonl", path: PATH, modifiedAt: 1 },
    ]);
    mocks.fsReadHead.mockResolvedValue("");
    mocks.fsReadTailChanged.mockImplementation(
      async (_path: string, _max: number, lastSize: number | null) =>
        lastSize == null
          ? { changed: true, size: TAIL.length, text: TAIL }
          : { changed: false, size: TAIL.length, text: "" },
    );

    expect((await profile.readSessionStatus!("/ws", "abc123"))).toEqual({
      model: "gpt-5.3",
      thinkingLevel: undefined,
    });
    /* 尺寸未变的后续拍:纯探测,零 collect/head/解析 */
    expect((await profile.readSessionStatus!("/ws", "abc123"))).toEqual({
      model: "gpt-5.3",
      thinkingLevel: undefined,
    });
    expect(mocks.fsCollectFiles).toHaveBeenCalledTimes(1);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(1);
    expect(mocks.fsReadTailChanged).toHaveBeenLastCalledWith(PATH, 0, TAIL.length);
  });
});
