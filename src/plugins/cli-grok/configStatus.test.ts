/**
 * grok 默认状态映射测试:config.toml → CliSessionStatus。
 * fixture 形状实证自本机 ~/.grok/config.toml(grok 1.0.4)。
 */

import { describe, expect, it } from "vitest";
import { parseGrokConfigStatus } from "./configStatus";

describe("parseGrokConfigStatus", () => {
  it("实证配置:模型取档案 wire id(grok-4.6),非档案 id", () => {
    const config = [
      "[models]",
      'default = "grok"',
      '[model."grok"]',
      'model = "grok-4.6"',
      'base_url = "https://fufei.mossx.ai/v1"',
      'api_key = "sk-test"',
    ].join("\n");
    expect(parseGrokConfigStatus(config)).toEqual({ model: "grok-4.6" });
  });

  it("reasoning_effort 落盘时映射 thinkingLevel", () => {
    const config = [
      '[model."grok"]',
      'model = "grok-4.6"',
      'reasoning_effort = "high"',
    ].join("\n");
    expect(parseGrokConfigStatus(config)).toEqual({
      model: "grok-4.6",
      thinkingLevel: "high",
    });
  });

  it("裸配置(无档案块):模型 = 内置默认 id grok", () => {
    expect(parseGrokConfigStatus("")).toEqual({ model: "grok" });
  });
});
