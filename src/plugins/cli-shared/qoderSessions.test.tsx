/**
 * qoder 共享层纯函数契约测试:slug 与 claude 同规则、会话状态提取(runtime-config +
 * assistant 双帧型)、settings.json 默认状态解析(实证样例为锚)。
 */

import { describe, expect, it, vi } from "vitest";

/* 共享层 import 链带 ipc(qoderSessions→userMessages/diskSessions);纯函数用例不触达,给全桩。 */
vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: vi.fn(async () => "/home"),
    fsCollectFiles: vi.fn(async () => []),
    fsReadHead: vi.fn(async () => ""),
    fsReadTail: vi.fn(async () => ""),
    fsReadFile: vi.fn(async () => ""),
  },
}));

import {
  extractQoderSessionStatus,
  parseQoderSettingsStatus,
  qoderProjectSlug,
} from "./qoderSessions";

describe("qoderProjectSlug", () => {
  it("与 claude 同规则:常规路径非字母数字逐字符替换", () => {
    expect(qoderProjectSlug("/Users/x/code/AI/github/mossx")).toBe(
      "-Users-x-code-AI-github-mossx",
    );
  });

  it("非 ASCII 每字符一个 -(实证 ~/.qoder/projects CJK 目录)", () => {
    expect(qoderProjectSlug("/Users/x/code/内容分析")).toBe("-Users-x-code-----");
  });

  it("点号替换(实证 codemoss ↔ -Users-…-github-codemoss 逐字符吻合)", () => {
    expect(qoderProjectSlug("/Users/x/.qoder")).toBe("-Users-x--qoder");
  });
});

describe("extractQoderSessionStatus", () => {
  const runtimeConfig = (model: string, effort: string | null) =>
    JSON.stringify({
      type: "runtime-config",
      model,
      reasoningEffort: effort,
      contextWindow: null,
    });
  const assistantLine = (model: string, isApiErrorMessage = false) =>
    JSON.stringify({
      type: "assistant",
      ...(isApiErrorMessage ? { isApiErrorMessage: true } : {}),
      message: { role: "assistant", model },
    });

  it("runtime-config 帧:model 与 reasoningEffort 双观测(实证 37cf4daf 会话)", () => {
    const tail = [runtimeConfig("lite", null), runtimeConfig("qmodel_38max", "max")].join(
      "\n",
    );
    expect(extractQoderSessionStatus(tail)).toEqual({
      model: "qmodel_38max",
      thinkingLevel: "max",
    });
  });

  it("reasoningEffort=null 不伪造思考强度(实证多数 runtime-config 帧)", () => {
    expect(extractQoderSessionStatus(runtimeConfig("qmodel_38max", null))).toEqual({
      model: "qmodel_38max",
      thinkingLevel: undefined,
    });
  });

  it("只有 assistant 帧:最近非错误帧 model 兜底", () => {
    const tail = [assistantLine("lite"), assistantLine("qmodel_38max")].join("\n");
    expect(extractQoderSessionStatus(tail)).toEqual({
      model: "qmodel_38max",
      thinkingLevel: undefined,
    });
  });

  it("错误帧(<synthetic>)跳过,更早真实模型胜出(实证 credit 耗尽场景)", () => {
    const tail = [
      runtimeConfig("qmodel_38max", null),
      assistantLine("<synthetic>", true),
    ].join("\n");
    expect(extractQoderSessionStatus(tail)).toEqual({
      model: "qmodel_38max",
      thinkingLevel: undefined,
    });
  });

  it("两帧混排:逐字段取倒序首个非空观测", () => {
    const tail = [
      runtimeConfig("qmodel_38max", "max"),
      assistantLine("lite"),
    ].join("\n");
    expect(extractQoderSessionStatus(tail)).toEqual({
      model: "lite",
      thinkingLevel: "max",
    });
  });

  it("坏行(尾部截断)跳过;无任何模型信号 = null", () => {
    expect(extractQoderSessionStatus('{"type":"assistant","mess')).toBeNull();
    expect(
      extractQoderSessionStatus(JSON.stringify({ type: "user", uuid: "u1" })),
    ).toBeNull();
  });
});

describe("parseQoderSettingsStatus", () => {
  it("实证样例(cn):model.name + 同名偏好 reasoning.effort", () => {
    const settings = JSON.stringify({
      permissions: {},
      model: {
        name: "kimi/kimi-k3-cp",
        preferences: {
          "kimi/kimi-k3-cp": { reasoning: { enabled: true, effort: "max" } },
        },
      },
    });
    expect(parseQoderSettingsStatus(settings)).toEqual({
      model: "kimi/kimi-k3-cp",
      thinkingLevel: "max",
    });
  });

  it("偏好键与当前模型不同名(实证 global 遗留 minimax 键)→ 仅 model", () => {
    const settings = JSON.stringify({
      model: {
        name: "qmodel_38max",
        preferences: {
          "minimax/minimax-m3-cp": { reasoning: { enabled: true, effort: "max" } },
        },
      },
    });
    expect(parseQoderSettingsStatus(settings)).toEqual({
      model: "qmodel_38max",
      thinkingLevel: undefined,
    });
  });

  it("model 缺名且无 effort → null;异型 JSON / 缺 model 块 / model 非对象 = null(不猜)", () => {
    expect(
      parseQoderSettingsStatus(JSON.stringify({ model: { preferences: {} } })),
    ).toBeNull();
    expect(parseQoderSettingsStatus("not json")).toBeNull();
    expect(parseQoderSettingsStatus('{"security":{}}')).toBeNull();
    expect(parseQoderSettingsStatus('{"model":"lite"}')).toBeNull();
  });
});
