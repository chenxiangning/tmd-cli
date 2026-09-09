/**
 * codex 图形化配置契约:顶层平面键行级补丁,托管段逐字节保留。
 * fixture = 本机 ~/.codex/config.toml 结构快照(含注释段与嵌套表)。
 */
import { describe, expect, it } from "vitest";
import { loadCodexConfig, parseProviderNames, saveCodexConfig } from "./configGui";
import type { CliConfigValues } from "@kernel/cliConfigRegistry";

const TOML = `model_provider = "custom"
model = "MiniMax-M3"
web_search = "disabled"
disable_response_storage = true
model_reasoning_effort = "high"
service_tier = "default"

[model_providers.custom]
name = "minimax"
base_url = "https://api.minimaxi.com/v1"
requires_openai_auth = true

# 信任目录由 Codex 自管理
[projects."/Users/x/repo"]
trust_level = "trusted"

[mcp_servers.node_repl]
args = []
command = "/path/node_repl"
`;

describe("load", () => {
  it("六键读出,布尔/字符串各归其位", () => {
    const v = loadCodexConfig(TOML);
    expect(v.model).toBe("MiniMax-M3");
    expect(v.model_provider).toBe("custom");
    expect(v.disable_response_storage).toBe(true);
    expect(v.model_reasoning_effort).toBe("high");
    expect(v.web_search).toBe("disabled");
    expect(v.service_tier).toBe("default");
  });

  it("providers 节名收集为供应商候选", () => {
    expect(loadCodexConfig(TOML).providers).toEqual(["custom"]);
  });
});

describe("save:字节保真", () => {
  const patch = (over: Partial<CliConfigValues>): string =>
    saveCodexConfig(TOML, { ...loadCodexConfig(TOML), ...over } as CliConfigValues);

  it("原值写回 = 恒等", () => {
    expect(saveCodexConfig(TOML, loadCodexConfig(TOML))).toBe(TOML);
  });

  it("改 model 只动该行;[model_providers]/[projects]/注释与空行原样", () => {
    const out = patch({ model: "gpt-5.2" });
    expect(out).toContain('model = "gpt-5.2"\n');
    expect(out).not.toContain('model = "MiniMax-M3"');
    expect(out).toContain('base_url = "https://api.minimaxi.com/v1"');
    expect(out).toContain("# 信任目录由 Codex 自管理");
    expect(out).toContain('trust_level = "trusted"');
    expect(out.split("\n").length).toBe(TOML.split("\n").length);
  });

  it("缺失键插进顶层区末尾,绝不落进 [section] 之后", () => {
    const out = patch({ model: "", model_provider: "newprov" });
    const head = out.slice(0, out.indexOf("["));
    expect(head).toContain('model_provider = "newprov"');
    expect(out.indexOf("model_provider = ")).toBeLessThan(out.indexOf("[model_providers"));
  });
  it("清空文本键 = 删顶层行(与 claude/pi 语义对齐)", () => {
    const out = patch({ model: "" });
    expect(out).not.toMatch(/^model\s*=/m);
    expect(loadCodexConfig(out).model).toBe("");
  });

  it("缺省键未被触碰时不凭空插入", () => {
    const minimal = 'model = "m"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
    expect(saveCodexConfig(minimal, loadCodexConfig(minimal))).toBe(minimal);
  });

  it("布尔翻转写裸 true/false", () => {
    const out = patch({ disable_response_storage: false });
    expect(out).toContain("disable_response_storage = false\n");
    expect(loadCodexConfig(out).disable_response_storage).toBe(false);
  });
});

describe("parseProviderNames", () => {
  it("model_providers.X 节名 → 候选;其他节忽略", () => {
    expect(
      parseProviderNames('[model_providers.a]\nname = "x"\n[projects.y]\n[model_providers.b2]\n'),
    ).toEqual(["a", "b2"]);
  });
});
