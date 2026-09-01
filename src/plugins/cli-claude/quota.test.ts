/**
 * cli-claude quota 凭据提取测试:settings.json env 最小解析(纯函数)。
 * fixture 形状实证自本机 ~/.claude/settings.json。
 */
import { describe, expect, it } from "vitest";
import { parseClaudeSettingsEnv } from "./quota";

describe("parseClaudeSettingsEnv", () => {
  it("提取 env 的 ANTHROPIC_BASE_URL 与 ANTHROPIC_API_KEY", () => {
    const cred = parseClaudeSettingsEnv(
      JSON.stringify({
        alwaysThinkingEnabled: true,
        env: {
          ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
          ANTHROPIC_API_KEY: "sk-kimi-xxx",
        },
      }),
    );
    expect(cred.baseUrl).toBe("https://api.kimi.com/coding/");
    expect(cred.apiKey).toBe("sk-kimi-xxx");
  });

  it("ANTHROPIC_AUTH_TOKEN 优先于 ANTHROPIC_API_KEY", () => {
    const cred = parseClaudeSettingsEnv(
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: " bearer-token ",
          ANTHROPIC_API_KEY: "sk-api-key",
        },
      }),
    );
    expect(cred.apiKey).toBe("bearer-token");
  });

  it("无 AUTH_TOKEN 时回退 API_KEY", () => {
    const cred = parseClaudeSettingsEnv(
      JSON.stringify({ env: { ANTHROPIC_API_KEY: "sk-only" } }),
    );
    expect(cred.apiKey).toBe("sk-only");
    expect(cred.baseUrl).toBeUndefined();
  });

  it("缺 env 或字段返回空凭据", () => {
    expect(parseClaudeSettingsEnv("{}")).toEqual({});
    expect(parseClaudeSettingsEnv(`{"env":"not-object"}`)).toEqual({});
    expect(
      parseClaudeSettingsEnv(`{"env":{"CLAUDE_CODE_VERBOSE":"1"}}`),
    ).toEqual({});
  });

  it("非法 JSON 抛错(由调用方 try/catch 兜底)", () => {
    expect(() => parseClaudeSettingsEnv("not json")).toThrow();
  });
});
