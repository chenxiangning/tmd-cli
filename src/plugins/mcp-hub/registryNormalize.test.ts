/**
 * mcp-hub/registryNormalize 契约测试 —— 三源卡片归一 + {VAR} 模板系统。
 * 样例取自 2026-09-28 各源公开 API 实测形状(official remotes/packages、
 * smithery 详情 connections.configSchema、glama environmentVariablesJsonSchema)。
 */
import { describe, expect, it } from "vitest";

import {
  applyDraftValues,
  applySmitheryDetail,
  configInputsFromJsonSchema,
  makeDraft,
  normalizeGlama,
  normalizeOfficial,
  normalizeSmitherySearch,
  slugify,
  templateNames,
} from "./registryNormalize";

describe("official 归一", () => {
  const raw = {
    server: {
      name: "io.modelcontextprotocol/brave",
      description: "Web search",
      websiteUrl: "https://example.com",
      version: "1.0.0",
      remotes: [{ type: "streamable-http", url: "https://api.example.com/{apiKey}/mcp" }],
      packages: [
        {
          registryType: "npm",
          identifier: "brave-mcp",
          transport: { type: "stdio" },
          environmentVariables: [
            { name: "BRAVE_API_KEY", description: "API key", isRequired: true },
            { name: "OPTIONAL", isRequired: false },
          ],
        },
      ],
    },
  };

  it("远程 remotes → installDraft(占位扫描成 url 输入)", () => {
    const card = normalizeOfficial(raw)!;
    expect(card.installDraft?.server).toEqual({ url: "https://api.example.com/{apiKey}/mcp", headers: {} });
    expect(card.installDraft?.configInputs).toEqual([
      { name: "apiKey", label: "apiKey", required: true, secret: true, target: "url" },
    ]);
  });

  it("packages → manualDraft(command 建议 + env 声明输入)", () => {
    const card = normalizeOfficial(raw)!;
    expect(card.manualDraft?.server).toEqual({
      command: "npx",
      args: ["brave-mcp"],
      env: {},
    });
    expect(card.manualDraft?.configInputs).toContainEqual(
      expect.objectContaining({ name: "BRAVE_API_KEY", target: "env", required: true }),
    );
  });

  it("无名卡 = null;runtime_arguments 必填位转占位", () => {
    expect(normalizeOfficial({ server: { description: "x" } })).toBeNull();
    const withArgs = normalizeOfficial({
      server: {
        name: "a",
        packages: [{ registryType: "npm", identifier: "pkg", runtimeArguments: [{ type: "positional", isRequired: true, valueHint: "PORT" }] }],
      },
    })!;
    expect(withArgs.manualDraft?.server.args).toEqual(["{PORT}", "pkg"]);
    expect(withArgs.manualDraft?.configInputs).toContainEqual(
      expect.objectContaining({ name: "PORT", target: "argument" }),
    );
  });
});

describe("smithery 归一 + 详情回落", () => {
  it("搜索卡:qualifiedName 必备,无草稿", () => {
    const card = normalizeSmitherySearch({ qualifiedName: "brave", displayName: "Brave", useCount: 87 })!;
    expect(card.id).toBe("smithery:brave");
    expect(card.installDraft).toBeUndefined();
  });

  it("详情:deploymentUrl + configSchema → installDraft(url 输入);stdio → manualDraft(--config 模板)", () => {
    const base = normalizeSmitherySearch({ qualifiedName: "brave" })!;
    const detail = applySmitheryDetail(base, {
      deploymentUrl: "https://brave.run.tools",
      tools: [{ name: "a" }, { name: "b" }, { name: "c" }],
      connections: [
        {
          type: "http",
          deploymentUrl: "https://brave.run.tools",
          configSchema: {
            type: "object",
            required: ["braveApiKey"],
            properties: { braveApiKey: { type: "string", title: "Brave API Key" } },
          },
        },
        {
          type: "stdio",
          configSchema: { type: "object", required: ["k"], properties: { k: { type: "string" } } },
        },
      ],
    });
    expect(detail.toolsCount).toBe(3);
    expect(detail.installDraft?.server).toEqual({ url: "https://brave.run.tools" });
    expect(detail.installDraft?.configInputs.map((i) => i.name)).toEqual(["braveApiKey"]);
    expect(detail.manualDraft?.server).toEqual({
      command: "npx",
      args: ["-y", "@smithery/cli@latest", "run", "brave", "--config", '{"k":"{k}"}'],
    });
  });
});

describe("glama 归一", () => {
  it("schema → env 输入 + npx manualDraft;tools 数透传", () => {
    const card = normalizeGlama({
      id: "g1",
      name: "Graphql",
      packageName: "@graphql/mcp",
      toolsCount: 12,
      environmentVariablesJsonSchema: {
        type: "object",
        required: ["GRAPHQL_TOKEN"],
        properties: { GRAPHQL_TOKEN: { type: "string" } },
      },
    })!;
    expect(card.toolsCount).toBe(12);
    expect(card.manualDraft?.server).toEqual({ command: "npx", args: ["-y", "@graphql/mcp"], env: {} });
    expect(card.manualDraft?.configInputs).toEqual([
      expect.objectContaining({ name: "GRAPHQL_TOKEN", target: "env", secret: true, required: true }),
    ]);
  });
});

describe("模板系统", () => {
  it("templateNames 扫描 {VAR};slugify 小写连字符", () => {
    expect(templateNames("https://x/{a1}/{_b}/no{c-d}")).toEqual(["a1", "_b"]);
    expect(slugify("Brave Search / MCP")).toBe("brave-search-mcp");
    expect(slugify("---")).toBe("mcp-server");
  });

  it("configInputsFromJsonSchema:required/secret 判定", () => {
    const inputs = configInputsFromJsonSchema({
      type: "object",
      required: ["a"],
      properties: { a: { type: "string", title: "A" }, apiKey: { type: "string" } },
    });
    expect(inputs).toEqual([
      { name: "a", label: "A", required: true, secret: false, target: "url" },
      { name: "apiKey", label: "apiKey", required: false, secret: true, target: "url" },
    ]);
  });

  it("applyDraftValues:env/header/argument/url 四 target 语义", () => {
    const draft = makeDraft(
      { url: "https://x/{token}/mcp", command: "npx", args: ["run", "{name}"], env: {}, headers: {} },
      [
        { name: "ENV1", label: "ENV1", required: true, secret: false, target: "env" },
        { name: "Auth", label: "Auth", required: true, secret: false, target: "header" },
      ],
    );
    const entry = applyDraftValues(draft, {
      "url:token": "t1",
      "header:Auth": "Bearer x",
      "argument:name": "svc",
      "env:ENV1": "v1",
    });
    expect(entry.url).toBe("https://x/t1/mcp");
    expect(entry.headers).toEqual({ Auth: "Bearer x" });
    expect(entry.args).toEqual(["run", "svc"]);
    expect(entry.env).toEqual({ ENV1: "v1" });
  });

  it("applyDraftValues:url 无占位 = 追加查询参数;argument 无占位 = 追加;空值跳过", () => {
    const draft = makeDraft({ url: "https://x/mcp?z=1", command: "npx", args: ["a"] }, [
      { name: "k", label: "k", required: true, secret: false, target: "url" },
      { name: "extra", label: "extra", required: false, secret: false, target: "argument" },
    ]);
    const entry = applyDraftValues(draft, { "url:k": "v", "argument:extra": "" });
    expect(entry.url).toBe("https://x/mcp?z=1&k=v");
    expect(entry.args).toEqual(["a"]); // 空值不追加
    expect(applyDraftValues(draft, { "argument:extra": "e" }).args).toEqual(["a", "e"]);
  });
});
