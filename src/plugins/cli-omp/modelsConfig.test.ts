/**
 * omp models.yml 摘要纯函数测试 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 样式对齐本机真实 models.yml(camelCase;models 内嵌 input 列表不得误计入模型数)。
 */

import { describe, expect, it } from "vitest";
import { summarizeModelsConfig } from "./modelsConfig";

const SAMPLE = `providers:
  my-relay:
    baseUrl: https://fufei.mossx.ai/v1
    api: openai-responses
    apiKey: sk-abc
    models:
      - id: grok-4.6
        name: Grok 4.6 (中转)
        reasoning: true
        input:
          - text
          - image
  qwen-cn:
    baseUrl: https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
    api: openai-completions
    models:
      - id: qwen3.8-max
        name: Qwen3.8 Max
        input:
          - text
      - id: qwen3.8-flash
        name: Qwen3.8 Flash
`;

describe("summarizeModelsConfig", () => {
  it("逐 provider 摘要:baseUrl/api/modelCount/hasKey", () => {
    const s = summarizeModelsConfig(SAMPLE);
    expect(s.length).toBe(2);
    expect(s[0]).toEqual({
      name: "my-relay",
      baseUrl: "https://fufei.mossx.ai/v1",
      api: "openai-responses",
      modelCount: 1,
      hasKey: true,
    });
    expect(s[1].name).toBe("qwen-cn");
    expect(s[1].modelCount).toBe(2); // 嵌套 input 的 - text 不计入
    expect(s[1].hasKey).toBe(false);
  });

  it("空文本 / 缺 providers = 空列表", () => {
    expect(summarizeModelsConfig("")).toEqual([]);
    expect(summarizeModelsConfig("symbolPreset: unicode\n")).toEqual([]);
  });
});

import {
  buildProviderBlock,
  insertProvider,
  validateProviderInput,
} from "./modelsConfig";

const P = {
  name: "extra",
  baseUrl: "https://x.example.com/v1",
  api: "openai-completions",
  apiKey: "sk-z",
  models: ["m1", "m2"],
};

describe("buildProviderBlock / insertProvider", () => {
  it("块形状:2 缩进 key、apiKey 可省、models 每条 id+name", () => {
    expect(buildProviderBlock({ ...P, apiKey: "" })).toBe(
      "  extra:\n    baseUrl: https://x.example.com/v1\n    api: openai-completions\n    models:\n      - id: m1\n        name: m1\n      - id: m2\n        name: m2",
    );
  });

  it("插入已有 providers 块尾(摘要可读回,嵌套 input 不误计)", () => {
    const next = insertProvider(SAMPLE, P);
    const s = summarizeModelsConfig(next);
    expect(s.map((p) => p.name)).toEqual(["my-relay", "qwen-cn", "extra"]);
    expect(s[2].modelCount).toBe(2);
    expect(s[2].hasKey).toBe(true);
    // 原有 provider 摘要不变
    expect(s[0].modelCount).toBe(1);
  });

  it("空文 / 无 providers 键 各自补键", () => {
    expect(insertProvider("", P)).toMatch(/^providers:\n  extra:/);
    expect(insertProvider("symbolPreset: unicode\n", P)).toMatch(
      /symbolPreset: unicode\n\nproviders:\n  extra:/,
    );
  });
});

describe("validateProviderInput", () => {
  it("合法值 trim 通过", () => {
    expect(validateProviderInput({ ...P, name: " extra " }, []).name).toBe("extra");
  });
  it("重名 / 坏名 / 空地址 / 空模型 / 未知协议 抛错", () => {
    expect(() => validateProviderInput(P, ["extra"])).toThrow(/已存在/);
    expect(() => validateProviderInput({ ...P, name: "1abc" }, [])).not.toThrow();
    expect(() => validateProviderInput({ ...P, name: "a b" }, [])).toThrow(/名称/);
    expect(() => validateProviderInput({ ...P, baseUrl: "  " }, [])).toThrow(/API 地址/);
    expect(() => validateProviderInput({ ...P, models: ["  "] }, [])).toThrow(/至少填写一个模型/);
    expect(() => validateProviderInput({ ...P, api: "nope" }, [])).toThrow(/未知协议/);
  });
});
