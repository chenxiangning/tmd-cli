/**
 * 手机引擎表 ↔ 桌面插件 profile 对齐(第二轮评审 TestQuality P1-4):
 * engines.ts 是手抄镜像(cmd + resume 各自双份),qoder cmd drift 已实证过一次;
 * 插件改 command/resumeArgs 后镜像静默 stale = 手机续聊/发起全坏,套件零信号。
 * 此处 activate 捕获真实 profile 逐引擎对齐,镜像漂移即红。
 * 测试豁免 mobile import 禁令:本文件不进 mobile bundle(mobileMain 不引用),
 * activate 捕获是对齐测试的唯一手段(生产树禁令不受影响)。
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { ENGINES, engineWire } from "./engines";

const PLUGINS: Record<string, () => Promise<Plugin>> = {
  omp: () => import("@plugins/cli-omp/index").then((m) => m.cliOmpPlugin),
  pi: () => import("@plugins/cli-pi/index").then((m) => m.cliPiPlugin),
  claude: () => import("@plugins/cli-claude/index").then((m) => m.cliClaudePlugin),
  codex: () => import("@plugins/cli-codex/index").then((m) => m.cliCodexPlugin),
  kimi: () => import("@plugins/cli-kimi/index").then((m) => m.cliKimiPlugin),
  grok: () => import("@plugins/cli-grok/index").then((m) => m.cliGrokPlugin),
  qoder: () => import("@plugins/cli-qoder/index").then((m) => m.cliQoderPlugin),
  "qoder-cn": () => import("@plugins/cli-qoder-cn/index").then((m) => m.cliQoderCnPlugin),
  opencode: () => import("@plugins/cli-opencode/index").then((m) => m.cliOpencodePlugin),
  dsh: () => import("@plugins/cli-dsh/plugin").then((m) => m.cliDshPlugin),
};

/** 预热后的插件实例表(beforeAll 填)。 */
const LOADED = new Map<string, Plugin>();

/* 模块级预热:动态 import 的冷变换成本(omp 图最大 —— React 组件 + academy
 * 目录 + phosphor 图标)与"profile 形状"无关,却记在用例预算里。2026-10-13
 * 门禁实测:omp 那一例(文件内首个,吃全量冷变换)超 30s 硬顶必红,单跑亦复现。
 * 把冷变换整体移出用例预算,用例只留 activate + 断言。 */
beforeAll(async () => {
  const ids = Object.keys(PLUGINS);
  const mods = await Promise.all(ids.map((id) => PLUGINS[id]()));
  ids.forEach((id, i) => LOADED.set(id, mods[i]));
}, 300_000);

describe("手机引擎表与桌面插件 profile 对齐", () => {
  for (const e of ENGINES) {
    it(
      `${e.id}: command/resume/bracketedPaste 一致`,
      async () => {
        const plugin = LOADED.get(e.id);
        if (!plugin) throw new Error(`${e.id} 插件未装载(预热失败)`);
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
        /* BP 契约镜像(engineWire 靠它决定发送线格式),漂移 = 4 家引擎回车被吞。 */
        expect(e.bracketedPaste ?? false, "bracketedPaste").toBe(profile.bracketedPaste ?? false);
      },
      5_000,
    );
  }
});

describe("engineWire 发送线格式", () => {
  it("BP 引擎包标记再 CR,非 BP 引擎裸文本+CR", () => {
    expect(engineWire("omp", "/model")).toBe("\u001b[200~/model\u001b[201~\r");
    expect(engineWire("claude", "/model")).toBe("/model\r");
    expect(engineWire("dsh", "hi")).toBe("hi\r");
  });
});
