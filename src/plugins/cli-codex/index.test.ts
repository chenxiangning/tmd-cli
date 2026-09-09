/**
 * codex profile 注册契约测试 —— 钉死 bracketedPaste 阵营。
 *
 * 2026-09-06 PTY 探针实测(见 kernel/cli.ts bracketedPaste 注):codex 启动/恢复窗
 * 与斜杠弹层活跃态,裸「文本+CR」单 chunk 回车被编辑器吞("composer 发了但幕布没
 * 提交");BP 标记后走 handlePaste 通路,CR 照常提交,resume 场景 /model 实测执行。
 * 一旦被摘,composer/模型位点击在 codex 上回归「发了但没回车」。
 */
import { describe, expect, it } from "vitest";
import { cliCodexPlugin } from "./index";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";

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
  it("id 为 codex 且必须声明 bracketedPaste(启动/恢复窗吞回车的修复线)", () => {
    const profile = activateCapturingProfile();
    expect(profile.id).toBe("codex");
    expect(profile.bracketedPaste).toBe(true);
  });
});
