/**
 * Claude Code 图形化配置契约:顶层三键 + env 七键合并,
 * hooks/permissions 等结构化段与键序原样保留。
 * fixture 用 stringify 规范形态(展开数组;恒等写回断言依赖此)。
 */
import { describe, expect, it } from "vitest";
import { loadClaudeConfig, saveClaudeConfig } from "./configGui";
import type { CliConfigValues } from "@kernel/cliConfigRegistry";

const SETTINGS = `{
  "env": {
    "ANTHROPIC_API_KEY": "sk-secret",
    "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
    "ANTHROPIC_MODEL": "kimi-for-coding",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "262144"
  },
  "includeCoAuthoredBy": false,
  "permissions": {
    "allow": [
      "mcp__pencil"
    ]
  },
  "model": "fable",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "notify"
          }
        ]
      }
    ]
  },
  "alwaysThinkingEnabled": true,
  "theme": "auto"
}
`;

describe("load", () => {
  it("顶层三键 + env 托管键读出;未托管 env 键不露出", () => {
    const v = loadClaudeConfig(SETTINGS);
    expect(v.model).toBe("fable");
    expect(v.alwaysThinkingEnabled).toBe(true);
    expect(v.includeCoAuthoredBy).toBe(false);
    expect(v.apiKey).toBe("sk-secret");
    expect(v.baseUrl).toBe("https://api.kimi.com/coding/");
    expect(v.envModel).toBe("kimi-for-coding");
    expect(v.timeout).toBe("3000000");
    expect(v.opus).toBe("");
  });
});

describe("save", () => {
  const patch = (over: Partial<CliConfigValues>): string =>
    saveClaudeConfig(SETTINGS, { ...loadClaudeConfig(SETTINGS), ...over } as CliConfigValues);

  it("原值写回 = 恒等", () => {
    expect(saveClaudeConfig(SETTINGS, loadClaudeConfig(SETTINGS))).toBe(SETTINGS);
  });

  it("改 env 键只动该键;未托管 env 键与 hooks/permissions 原样保序", () => {
    const out = patch({ apiKey: "sk-new", opus: "k3" });
    const o = JSON.parse(out);
    expect(o.env.ANTHROPIC_API_KEY).toBe("sk-new");
    expect(o.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("k3");
    expect(o.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
    expect(o.hooks.Stop[0].hooks[0].command).toBe("notify");
    expect(o.permissions.allow).toEqual(["mcp__pencil"]);
    expect(Object.keys(o)).toEqual(Object.keys(JSON.parse(SETTINGS)));
  });

  it("空串删除对应 env 键;托管键全空但存在未托管键时 env 壳保留", () => {
    const out = patch({ timeout: "" });
    const o = JSON.parse(out);
    expect(o.env.API_TIMEOUT_MS).toBeUndefined();
    expect(o.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
  });

  it("includeCoAuthoredBy 回到默认 true 时删键(与缺省语义一致)", () => {
    const o = JSON.parse(patch({ includeCoAuthoredBy: true }));
    expect(o.includeCoAuthoredBy).toBeUndefined();
  });

  it("非法 JSON 抛错(错误态由 UI 呈现,不猜)", () => {
    expect(() => saveClaudeConfig("{oops", loadClaudeConfig(SETTINGS))).toThrow();
  });
});
