/**
 * omp profile 注册契约测试 —— 守护 composer 发送通路的关键声明。
 *
 * bracketedPaste 一旦被摘(或后续 pi-tui 系 CLI 漏声明),composer 整串
 * 正文+CR 同帧到达会被编辑器的"粘贴爆发"启发式吞掉提交回车,表现为
 * "composer 发了但幕布没提交,须再手按回车"(win 实测,见 kernel/cli.ts)。
 * 钉死 omp 与 pi/kimi 同阵营声明。
 */
import { describe, expect, it } from "vitest";
import { cliOmpPlugin } from "./index";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";

function activateCapturingProfile(): CliProfile {
  const captured: CliProfile[] = [];
  cliOmpPlugin.activate({
    registerCliProfile: (profile) => captured.push(profile),
  } as unknown as PluginContext);
  const profile = captured[0];
  if (!profile) throw new Error("activate 未注册任何 profile");
  return profile;
}

describe("cli-omp profile 注册契约", () => {
  it("id 为 omp 且必须声明 bracketedPaste(粘贴爆发吞回车的修复线)", () => {
    const profile = activateCapturingProfile();
    expect(profile.id).toBe("omp");
    expect(profile.bracketedPaste).toBe(true);
  });
});
