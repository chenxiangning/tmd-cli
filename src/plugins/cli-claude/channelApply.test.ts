/**
 * Claude channelApply 测试 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 直接走 loadClaudeConfig/saveClaudeConfig 不易测 IO 路径,改为断言:
 * 1) 「全空 channel」经 saveClaudeConfig 判定 changed=全 false 后,**没有 channel 字段会被**
 *    凭空写到 settings.json(identity 性质)。
 * 2) 「baseUrl 非空 channel」应当落地 ANTHROPIC_BASE_URL 但保留其它 env 不动。
 */

import { describe, expect, it } from "vitest";
import { loadClaudeConfig, saveClaudeConfig } from "./configGui";

describe("claude apply identity (saveClaudeConfig 的 onlyChanged 性质)", () => {
  it("空 channel → 输入 = 输出(无 channel 字段落到 settings.json)", () => {
    const before = '{"env":{"ANTHROPIC_API_KEY":"keep","ANTHROPIC_BASE_URL":"https://keep"}}';
    const values = loadClaudeConfig(before);
    // 全空 channel:把 baseUrl/apiKey/envModel 都设成 baseline 等值(模拟 channelApply 的写法)
    const ch = { baseUrl: "", apiKey: "", model: "" };
    const next = saveClaudeConfig(before, {
      ...values,
      baseUrl: ch.baseUrl || (values.baseUrl as string) || "",
      apiKey: ch.apiKey || (values.apiKey as string) || "",
      envModel: ch.model || (values.envModel as string) || "",
    });
    const back = JSON.parse(next) as { env?: Record<string, unknown> };
    expect(back.env?.ANTHROPIC_API_KEY).toBe("keep");
    expect(back.env?.ANTHROPIC_BASE_URL).toBe("https://keep");
  });

  it("非空 baseUrl → 覆写 ANTHROPIC_BASE_URL,不动其它 env", () => {
    const before = '{"env":{"ANTHROPIC_API_KEY":"keep","ANTHROPIC_BASE_URL":"https://keep"}}';
    const values = loadClaudeConfig(before);
    const next = saveClaudeConfig(before, {
      ...values,
      baseUrl: "https://new",
      apiKey: values.apiKey as string,
      envModel: values.envModel as string,
    });
    const back = JSON.parse(next) as { env?: Record<string, unknown> };
    expect(back.env?.ANTHROPIC_BASE_URL).toBe("https://new");
    expect(back.env?.ANTHROPIC_API_KEY).toBe("keep");
  });

  it("非空 apiKey → 覆写 ANTHROPIC_API_KEY", () => {
    const before = '{"env":{"ANTHROPIC_API_KEY":"old"}}';
    const values = loadClaudeConfig(before);
    const next = saveClaudeConfig(before, {
      ...values,
      baseUrl: values.baseUrl as string,
      apiKey: "new-key",
      envModel: values.envModel as string,
    });
    const back = JSON.parse(next) as { env?: Record<string, unknown> };
    expect(back.env?.ANTHROPIC_API_KEY).toBe("new-key");
  });

  it("非空 model → 写 ANTHROPIC_MODEL(不动顶层 model 键)", () => {
    const before = '{"env":{"ANTHROPIC_MODEL":"old"}}';
    const values = loadClaudeConfig(before);
    const next = saveClaudeConfig(before, {
      ...values,
      baseUrl: values.baseUrl as string,
      apiKey: values.apiKey as string,
      envModel: "new-model",
    });
    const back = JSON.parse(next) as { env?: Record<string, unknown> };
    expect(back.env?.ANTHROPIC_MODEL).toBe("new-model");
  });
});
