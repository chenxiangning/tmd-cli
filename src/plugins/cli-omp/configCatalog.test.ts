/**
 * omp 模型目录装配测试:omp models --json 解析 + 双源并集合并。
 */
import { describe, expect, it } from "vitest";
import { mergeCatalogs, parseOmpModelsJson } from "./configCatalog";

/* `omp models --json` 真实输出形态摘录(2026-09-09 本机实测)。 */
const CLI_JSON = JSON.stringify({
  models: [
    { provider: "kimi-code", id: "k3", name: "K3", thinking: ["low", "high", "max"] },
    { provider: "kimi-code", id: "k3-256k", name: "K3 256K", thinking: ["low", "high", "max"] },
    { provider: "qwen-cn", id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { provider: "zhipu-coding-plan", id: "glm-5", name: "GLM-5", thinking: ["low", "high"] },
  ],
});

describe("parseOmpModelsJson", () => {
  it("按供应商分组,thinking 作思考强度候选", () => {
    const catalog = parseOmpModelsJson(CLI_JSON);
    expect(catalog.map((p) => p.id)).toEqual(["kimi-code", "qwen-cn", "zhipu-coding-plan"]);
    const kimi = catalog[0];
    expect(kimi.authed).toBe(true);
    expect(kimi.models.map((m) => m.id)).toEqual(["k3", "k3-256k"]);
    expect(kimi.models[0].label).toBe("K3");
    expect(kimi.models[0].suffixes).toEqual(["low", "high", "max"]);
    // 无 thinking 的模型不带后缀候选
    expect(catalog[1].models[0].suffixes).toBeUndefined();
  });

  it("坏 JSON / 空输出 → 空目录不炸", () => {
    expect(parseOmpModelsJson("not json")).toEqual([]);
    expect(parseOmpModelsJson("{}")).toEqual([]);
  });
});

describe("mergeCatalogs", () => {
  it("CLI 为主源,yml 独有供应商补入并标已配置", () => {
    const cli = parseOmpModelsJson(CLI_JSON);
    const yml = [
      { id: "kimi-code", label: "Kimi 定制", models: [{ id: "k3-512k" }], authed: true },
      { id: "my-relay", models: [{ id: "grok-4.6", label: "Grok 4.6" }], authed: true },
    ];
    const merged = mergeCatalogs(cli, yml);
    expect(merged.map((p) => p.id)).toEqual(["kimi-code", "qwen-cn", "zhipu-coding-plan", "my-relay"]);
    // yml 独有供应商标「已配置」且不标 authed
    const relay = merged.find((p) => p.id === "my-relay")!;
    expect(relay.badge).toBe("已配置");
    expect(relay.authed).toBe(false);
    // 同供应商模型并集去重
    const kimi = merged[0];
    expect(kimi.models.map((m) => m.id)).toEqual(["k3", "k3-256k", "k3-512k"]);
    expect(kimi.label).toBe("Kimi 定制");
  });

  it("CLI 不可用(空)时 yml 单源兜底", () => {
    const merged = mergeCatalogs([], [{ id: "my-relay", models: [{ id: "grok-4.6" }], authed: true }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].badge).toBe("已配置");
  });
});
