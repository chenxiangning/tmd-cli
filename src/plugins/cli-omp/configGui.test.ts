/**
 * omp 图形化配置契约:行级补丁必须「只动托管行」。
 * fixture = 本机 ~/.omp/agent/config.yml 真实快照 + models.yml 目录解析。
 */
import { describe, expect, it } from "vitest";
import { loadOmpConfig, saveOmpConfig } from "./configGui";
import { parseModelCatalog } from "./configCatalog";
import type { CliConfigValues } from "@kernel/cliConfigRegistry";

const CONFIG = `modelRoles:
  smol: minimax-code-cn/MiniMax-M3:high
  default: zhipu-coding-plan/glm-5.3-flash:max
symbolPreset: unicode
setupVersion: 2
retry:
  fallbackChains:
    default:
      - minimax-code-cn/MiniMax-M3:high
defaultThinkingLevel: auto
dev:
  autoqaConsent: granted
memory:
  backend: "off"
compaction:
  enabled: false
# 手写注释
ttsr:
  enabled: true
  interruptMode: always
webSearch:
  providerChain: [exa, gemini]
`;

const MODELS_YML = `providers:
  my-relay:
    name: My Relay
    baseUrl: https://x/v1
    models:
      - id: grok-4.6
        name: Grok 4.6
      - id: second-model
        thinkingLevelMap:
          max: high
          xhigh: high
  qwen-cn:
    baseUrl: https://y/v1
    models:
      - id: qwen3.8-max
`;

describe("models.yml 目录解析", () => {
  it("providers × models × thinkingLevelMap → 结构化候选", () => {
    expect(parseModelCatalog(MODELS_YML)).toEqual([
      {
        id: "my-relay",
        label: "My Relay",
        authed: true,
        models: [
          { id: "grok-4.6", label: "Grok 4.6" },
          { id: "second-model", suffixes: ["max", "xhigh"] },
        ],
      },
      { id: "qwen-cn", authed: true, models: [{ id: "qwen3.8-max" }] },
    ]);
  });
});

describe("load", () => {
  it("角色 map / 思考后缀 / 链 / 开关 / 搜索链全读出", () => {
    const v = loadOmpConfig(CONFIG);
    expect(v.roles).toEqual([
      ["smol", "minimax-code-cn/MiniMax-M3:high"],
      ["default", "zhipu-coding-plan/glm-5.3-flash:max"],
    ]);
    expect(v.modelFallback).toBe(true);
    expect(v.chains).toEqual([["default", "minimax-code-cn/MiniMax-M3:high"]]);
    expect(v.memoryBackend).toBe("off");
    expect(v.compactionEnabled).toBe(false);
    expect(v.ttsrEnabled).toBe(true);
    expect(v.webChain).toEqual(["exa", "gemini"]);
  });
});

describe("save:字节保真", () => {
  const patch = (over: Partial<CliConfigValues>): string =>
    saveOmpConfig(CONFIG, { ...loadOmpConfig(CONFIG), ...over } as CliConfigValues);

  it("原值写回 = 恒等", () => {
    const v = loadOmpConfig(CONFIG);
    expect(saveOmpConfig(CONFIG, v)).toBe(CONFIG);
  });

  it("改角色只动该行;未托管段(dev/setupVersion/注释)逐字保留", () => {
    const out = patch({
      roles: [
        ["smol", "kimi-code/k3"],
        ["default", "zhipu-coding-plan/glm-5.3-flash:max"],
      ],
    });
    expect(out).toContain("  smol: kimi-code/k3\n");
    expect(out).toContain("  autoqaConsent: granted");
    expect(out).toContain("# 手写注释");
    expect(out).toContain("setupVersion: 2");
    expect(out.split("\n").length).toBe(CONFIG.split("\n").length);
  });

  it("新增角色追加进 modelRoles 块,不重复建块", () => {
    const out = patch({
      roles: [
        ["smol", "minimax-code-cn/MiniMax-M3:high"],
        ["default", "zhipu-coding-plan/glm-5.3-flash:max"],
        ["advisor", "anthropic/claude-haiku-4.5"],
      ],
    });
    expect(out.match(/^modelRoles:$/gm)?.length).toBe(1);
    expect(loadOmpConfig(out).roles).toContainEqual(["advisor", "anthropic/claude-haiku-4.5"]);
  });

  it("回退链改写列表;开关翻转写布尔", () => {
    const out = patch({
      chains: [["default", "a/b:high, c/d"]],
      compactionEnabled: true,
      memoryBackend: "mnemopi",
    });
    const back = loadOmpConfig(out);
    expect(back.chains).toEqual([["default", "a/b:high,c/d"]]);
    expect(back.compactionEnabled).toBe(true);
    expect(back.memoryBackend).toBe("mnemopi");
    expect(out).toContain("  enabled: true");
  });
  it("空键行(表单半成品)不落盘,P0 回归", () => {
    const out = patch({ chains: [["", "a/b"], ["default", "x/y"]] });
    expect(out).not.toMatch(/^\s*:/m);
    expect(loadOmpConfig(out).chains).toEqual([["default", "x/y"]]);
  });


  it("空文件(项目级首次创建)也能生成全段", () => {
    const out = saveOmpConfig("", loadOmpConfig(CONFIG));
    expect(out).toContain("modelRoles:");
    expect(out).toContain("fallbackChains:");
    expect(loadOmpConfig(out).roles).toEqual(loadOmpConfig(CONFIG).roles);
  });
});
