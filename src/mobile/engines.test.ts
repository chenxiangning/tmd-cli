/**
 * 手机引擎表 ↔ 桌面插件 profile 对齐(第二轮评审 TestQuality P1-4):
 * engines.ts 是手抄镜像(cmd + resume 各自双份),qoder cmd drift 已实证过一次;
 * 插件改 command/resumeArgs 后镜像静默 stale = 手机续聊/发起全坏,套件零信号。
 * 此处 activate 捕获真实 profile 逐引擎对齐,镜像漂移即红。
 */
import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { ENGINES } from "./engines";

const PLUGINS: Record<string, () => Promise<Plugin>> = {
  omp: () => import("@plugins/cli-omp/index").then((m) => m.cliOmpPlugin),
  pi: () => import("@plugins/cli-pi/index").then((m) => m.cliPiPlugin),
  claude: () => import("@plugins/cli-claude/index").then((m) => m.cliClaudePlugin),
  codex: () => import("@plugins/cli-codex/index").then((m) => m.cliCodexPlugin),
  kimi: () => import("@plugins/cli-kimi/index").then((m) => m.cliKimiPlugin),
  grok: () => import("@plugins/cli-grok/index").then((m) => m.cliGrokPlugin),
  qoder: () => import("@plugins/cli-qoder/index").then((m) => m.cliQoderPlugin),
  opencode: () => import("@plugins/cli-opencode/index").then((m) => m.cliOpencodePlugin),
};

describe("手机引擎表与桌面插件 profile 对齐", () => {
  for (const e of ENGINES) {
    it(`${e.id}: command 与 resumeArgs 一致`, async () => {
      const plugin = await PLUGINS[e.id]();
      let profile: CliProfile | undefined;
      /* activate 会登记多个注册面(cliConfig/marketPanel…),Proxy 全吞,只捕获 profile。 */
      const ctx = new Proxy(
        { registerCliProfile: (p: CliProfile) => (profile = p) },
        { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => {}) },
      );
      plugin.activate(ctx as never);
      if (!profile) throw new Error(`${e.id} activate 未注册 profile`);
      expect(profile.id, "profile id").toBe(e.id);
      expect(profile.command, "启动命令").toBe(e.cmd);
      expect(profile.resumeArgs?.("S1"), "续聊参数").toEqual(e.resume("S1"));
    });
  }
});
