/**
 * omp 默认状态解析契约测试。
 * 实证配置面:modelRoles.default(可带 :thinking 后缀) + defaultThinkingLevel。
 */
import { describe, expect, it } from "vitest";
import { parseOmpConfigStatus } from "./configStatus";

const REAL_CONFIG = `modelRoles:
  smol: kimi-code/k3:high
  default: minimax-code-cn/MiniMax-M3
symbolPreset: unicode
setupVersion: 2
retry:
  fallbackChains:
    default:
      - openai-codex/gpt-5.6-terra
defaultThinkingLevel: auto
`;

describe("parseOmpConfigStatus", () => {
  it("实证形态:default 无思考后缀 → 回落 defaultThinkingLevel", () => {
    expect(parseOmpConfigStatus(REAL_CONFIG)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "auto",
    });
  });

  it("default 带思考后缀 → 后缀优先于全局 defaultThinkingLevel", () => {
    const yml = `modelRoles:\n  default: kimi-code/k3:high\ndefaultThinkingLevel: auto\n`;
    expect(parseOmpConfigStatus(yml)).toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });
  });

  it("无 modelRoles 段 → 仅思考强度;两者皆无 → null", () => {
    expect(parseOmpConfigStatus("defaultThinkingLevel: high\n")).toEqual({
      thinkingLevel: "high",
    });
    expect(parseOmpConfigStatus("symbolPreset: unicode\n")).toBeNull();
    expect(parseOmpConfigStatus("")).toBeNull();
  });
});
