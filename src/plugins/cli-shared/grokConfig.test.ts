/**
 * grok config.toml 解析契约测试。
 * fixture 形状实证自本机 ~/.grok/config.toml(grok 1.0.4)。
 */

import { describe, expect, it } from "vitest";
import { resolveGrokDefaultProfile } from "./grokConfig";

const FULL_CONFIG = [
  "[models]",
  'default = "grok"',
  'web_search = "grok"',
  "",
  '[model."grok"]',
  'model = "grok-4.6"',
  'base_url = "https://fufei.mossx.ai/v1"',
  'name = "Grok 4.6"',
  'api_key = "sk-test-123"',
  'api_backend = "responses"',
  "context_window = 1000000",
  "supports_backend_search = true",
].join("\n");

describe("resolveGrokDefaultProfile", () => {
  it("实证配置:取 [models].default 指向档案的 model/base_url/api_key", () => {
    expect(resolveGrokDefaultProfile(FULL_CONFIG)).toEqual({
      id: "grok",
      model: "grok-4.6",
      baseUrl: "https://fufei.mossx.ai/v1",
      apiKey: "sk-test-123",
      reasoningEffort: undefined,
    });
  });

  it("default 指向非默认名档案:精确取该档案块,不串档", () => {
    const config = [
      "[models]",
      'default = "kimi-relay"',
      '[model."grok"]',
      'model = "grok-4.6"',
      '[model."kimi-relay"]',
      'model = "kimi-k3"',
      'base_url = "https://relay.example/v1"',
      'api_key = "sk-other"',
    ].join("\n");
    expect(resolveGrokDefaultProfile(config)).toMatchObject({
      id: "kimi-relay",
      model: "kimi-k3",
      baseUrl: "https://relay.example/v1",
      apiKey: "sk-other",
    });
  });

  it("缺 [models] 段:回退二进制内置默认 id grok;档案块缺失时 model = id", () => {
    expect(resolveGrokDefaultProfile('[model."other"]\nmodel = "x"')).toEqual({
      id: "grok",

      model: "grok",
      baseUrl: undefined,
      apiKey: undefined,
      reasoningEffort: undefined,
    });
  });

  it("TOML 裸键档案头([model.grok])与引号键等价,同样命中", () => {
    const config = [
      "[models]",
      "default = grok",
      '[model."other"]',
      'model = "x"',
      "[model.grok]",
      'model = "grok-4.6"',
      'api_key = "sk-bare"',
    ].join("\n");
    expect(resolveGrokDefaultProfile(config)).toMatchObject({
      id: "grok",
      model: "grok-4.6",
      apiKey: "sk-bare",
    });
  });

  it("含点的 id 不试裸键形态(防误配嵌套表)", () => {
    const config = [
      "[models]",
      'default = "grok-4.6"',
      "[model.grok-4.6]",
      'model = "wrong"',
      '[model."grok-4.6"]',
      'model = "grok-4.6-wire"',
    ].join("\n");
    expect(resolveGrokDefaultProfile(config).model).toBe("grok-4.6-wire");
  });

  it("[models].default 缺键:同样回退 grok", () => {
    expect(resolveGrokDefaultProfile("[models]\n").id).toBe("grok");
  });

  it("reasoning_effort 落盘时透传;数值型键不误读", () => {
    const config = [
      "[models]",
      'default = "grok"',
      '[model."grok"]',
      'model = "grok-4.6"',
      'reasoning_effort = "high"',
      "context_window = 1000000",
    ].join("\n");
    expect(resolveGrokDefaultProfile(config).reasoningEffort).toBe("high");
  });
});
