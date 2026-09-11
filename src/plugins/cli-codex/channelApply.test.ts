/**
 * Codex channelApply 测试 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 覆盖:顶层 model/model_provider 写、[model_providers.tmd_channel] 段 upsert(保留其它段)、
 * auth.json 合并 OPENAI_API_KEY(已有键覆盖 / 缺文件创建)。
 */

import { describe, expect, it } from "vitest";
import { __test_only } from "./channelApply";

const { applyToml, applyAuth } = __test_only;

describe("applyToml (codex)", () => {
  it("无 baseUrl 只设 model", () => {
    const raw = 'model = "old"\n';
    const next = applyToml(raw, { id: "x", name: "x", model: "new", createdAt: 1 });
    expect(next).toContain('model = "new"');
    expect(next).not.toContain("[model_providers.tmd_channel]");
  });

  it("有 baseUrl → 写 model + model_provider + 段", () => {
    const raw = "model = \"old\"\n";
    const next = applyToml(raw, {
      id: "x", name: "My Relay", baseUrl: "https://relay.example.com", model: "gpt-5", createdAt: 1,
    });
    expect(next).toContain('model = "gpt-5"');
    expect(next).toContain('model_provider = "tmd_channel"');
    expect(next).toContain("[model_providers.tmd_channel]");
    expect(next).toContain('name = "My Relay"');
    expect(next).toContain('base_url = "https://relay.example.com"');
  });

  it("段已存在 → 替换 name/base_url,保留其它键", () => {
    const raw = [
      "[model_providers.tmd_channel]",
      'name = "old"',
      'base_url = "https://old"',
      'wire_api = "chat"',
      "[model_providers.other]",
      'base_url = "https://other"',
      "",
    ].join("\n");
    const next = applyToml(raw, {
      id: "x", name: "New", baseUrl: "https://new", model: "gpt-5", createdAt: 1,
    });
    expect(next).toContain('name = "New"');
    expect(next).toContain('base_url = "https://new"');
    expect(next).toContain('wire_api = "chat"');
    expect(next).toContain("[model_providers.other]");
    expect(next).toContain('base_url = "https://other"');
  });

  it("不动未托管区段([mcp_servers] 等)字节级", () => {
    const raw = [
      'model = "old"',
      "[mcp_servers.foo]",
      'command = "x"',
      "",
    ].join("\n");
    const next = applyToml(raw, {
      id: "x", name: "x", baseUrl: "https://b", model: "gpt-5", createdAt: 1,
    });
    expect(next).toContain("[mcp_servers.foo]");
    expect(next).toContain('command = "x"');
  });
});

describe("applyAuth (codex)", () => {
  it("空 auth → 写 OPENAI_API_KEY", () => {
    const next = applyAuth("", "key");
    expect(JSON.parse(next)).toEqual({ OPENAI_API_KEY: "key" });
  });

  it("已有 auth → 合并,OPENAI_API_KEY 覆盖", () => {
    const next = applyAuth('{"OPENAI_API_KEY":"old","OTHER":"keep"}', "new");
    const obj = JSON.parse(next) as Record<string, unknown>;
    expect(obj.OPENAI_API_KEY).toBe("new");
    expect(obj.OTHER).toBe("keep");
  });

  it("坏 JSON → 视为空,只写新 key", () => {
    const next = applyAuth("not json", "new");
    expect(JSON.parse(next)).toEqual({ OPENAI_API_KEY: "new" });
  });
});
