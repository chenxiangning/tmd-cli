/**
 * cli-codex quota 分级策略测试:config.toml 最小提取(纯函数)。
 * fixture 形状实证自本机 ~/.codex/config.toml。
 */
import { describe, expect, it } from "vitest";
import { parseCodexConfigToml } from "./quota";

describe("parseCodexConfigToml", () => {
  it("提取顶层 model_provider 与对应段的 base_url", () => {
    const cfg = parseCodexConfigToml(`
model_provider = "custom"
model = "MiniMax-M3"

[model_providers.custom]
name = "minimax"
base_url = "https://api.minimaxi.com/v1"
wire_api = "responses"
`);
    expect(cfg.provider).toBe("custom");
    expect(cfg.baseUrl).toBe("https://api.minimaxi.com/v1");
  });

  it("段名带引号也可匹配", () => {
    const cfg = parseCodexConfigToml(`
model_provider = "my-relay"
[model_providers."my-relay"]
base_url = "https://relay.example.com/v1"
`);
    expect(cfg.baseUrl).toBe("https://relay.example.com/v1");
  });

  it("只提取 model_provider 对应段的 base_url,忽略其它段", () => {
    const cfg = parseCodexConfigToml(`
model_provider = "a"
[model_providers.b]
base_url = "https://b.example.com"
[model_providers.a]
base_url = "https://a.example.com"
`);
    expect(cfg.baseUrl).toBe("https://a.example.com");
  });

  it("注释与空行不影响解析", () => {
    const cfg = parseCodexConfigToml(`
# codex 配置
model_provider = "custom" # 当前供应商
[model_providers.custom]
base_url = "https://x.example.com/v1" # 中转
`);
    expect(cfg.baseUrl).toBe("https://x.example.com/v1");
  });

  it("缺 model_provider 或 base_url 时返回 undefined", () => {
    expect(parseCodexConfigToml("").provider).toBeUndefined();
    expect(parseCodexConfigToml(`model = "gpt-5"`).provider).toBeUndefined();
    expect(
      parseCodexConfigToml(`model_provider = "openai"\n[model_providers.openai]\nwire_api = "responses"`).baseUrl,
    ).toBeUndefined();
  });
});
