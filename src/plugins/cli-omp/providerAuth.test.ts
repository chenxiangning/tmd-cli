/**
 * omp 供应商认证纯函数测试 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 覆盖:maskKey 掩码规则、validateApiKey 校验、buildAuthIndex 凭据行归并
 * (api_key 取 key / oauth 入集合 / 坏 data 跳过 / disabled 行由 SQL 过滤)。
 */

import { describe, expect, it } from "vitest";
import { buildAuthIndex, maskKey, validateApiKey } from "./providerAuth";
import { OMP_APIKEY_PROVIDERS } from "./providerAuthCatalog";

describe("maskKey", () => {
  it("长 key 头 6 尾 4", () => {
    expect(maskKey("sk-4361abcdef1437")).toBe("sk-436········1437");
  });
  it("短 key 全掩", () => {
    expect(maskKey("short")).toBe("········");
  });
  it("!/$ 前缀(命令/环境变量引用)原样返回", () => {
    expect(maskKey("!op read token")).toBe("!op read token");
    expect(maskKey("$MY_TOKEN")).toBe("$MY_TOKEN");
  });
});

describe("validateApiKey", () => {
  it("trim 生效;目录外 id 同样允许(omp 计划供应商)", () => {
    expect(validateApiKey("  sk-abc  ")).toBe("sk-abc");
  });
  it("空 / 含换行 抛错", () => {
    expect(() => validateApiKey("   ")).toThrow(/不能为空/);
    expect(() => validateApiKey("a\nb")).toThrow(/换行/);
  });
});

describe("buildAuthIndex", () => {
  it("api_key 取 data.key;oauth 入集合;带 refresh 判自动刷新", () => {
    const { keys, oauthActive, oauthRefresh } = buildAuthIndex([
      ["deepseek", "api_key", JSON.stringify({ key: "sk-1" })],
      ["kimi-code", "oauth", JSON.stringify({ access: "a", refresh: "r" })],
      ["openai-codex", "oauth", JSON.stringify({ access: "a" })],
    ]);
    expect(keys.get("deepseek")).toBe("sk-1");
    expect(oauthActive.has("kimi-code")).toBe(true);
    expect(oauthRefresh.has("kimi-code")).toBe(true);
    expect(oauthRefresh.has("openai-codex")).toBe(false);
  });
  it("同 provider 多行取首条;坏 data 跳过不阻断", () => {
    const { keys, oauthActive } = buildAuthIndex([
      ["deepseek", "api_key", JSON.stringify({ key: "first" })],
      ["deepseek", "api_key", JSON.stringify({ key: "second" })],
      ["broken", "api_key", "not-json"],
      ["xai", "oauth", "also-broken"],
    ]);
    expect(keys.get("deepseek")).toBe("first");
    expect(keys.has("broken")).toBe(false);
    expect(oauthActive.has("xai")).toBe(false);
  });
});

describe("snapshotsFor via listOmpAuth(目录外补行,经 buildAuthIndex 语义)", () => {
  it("目录外 provider 自动补 configured 行(归并语义见 buildAuthIndex)", () => {
    // 快照拼装逻辑在 listOmpAuth(IO);此处只锁 keys 里目录外 id 的呈现契约:
    const { keys } = buildAuthIndex([["minimax-code-cn", "api_key", JSON.stringify({ key: "sk-plan-1" })]]);
    expect(keys.has("minimax-code-cn")).toBe(true);
    expect(OMP_APIKEY_PROVIDERS.some((p) => p.id === "minimax-code-cn")).toBe(false);
  });
});
