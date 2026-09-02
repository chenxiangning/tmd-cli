/**
 * pi 默认状态解析契约测试。
 * 实证 settings.json:defaultProvider / defaultModel / defaultThinkingLevel。
 */
import { describe, expect, it } from "vitest";
import { parsePiSettingsStatus } from "./configStatus";

describe("parsePiSettingsStatus", () => {
  it("实证形态:provider+model 拼限定名,思考强度直取", () => {
    expect(
      parsePiSettingsStatus({
        defaultProvider: "kimi-coding",
        defaultModel: "k3",
        defaultThinkingLevel: "high",
        packages: [],
      }),
    ).toEqual({ model: "kimi-coding/k3", thinkingLevel: "high" });
  });

  it("缺 provider → 裸 model;缺 thinking → 不携带该字段", () => {
    expect(parsePiSettingsStatus({ defaultModel: "k3" })).toEqual({
      model: "k3",
      thinkingLevel: undefined,
    });
  });

  it("非对象/全缺 → null(不猜)", () => {
    expect(parsePiSettingsStatus(null)).toBeNull();
    expect(parsePiSettingsStatus("k3")).toBeNull();
    expect(parsePiSettingsStatus({ theme: "light" })).toBeNull();
  });
});
