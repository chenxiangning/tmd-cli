/**
 * sessionStatus jsonl 尾部解析契约测试。
 * 覆盖:空输入/读取失败、畸形行跳过、meta 等非状态事件忽略、
 * 倒序取最新状态的优先级、provider/model 拼接与 key 优先级、
 * assistant message 作为模型信号(resume 路径不落 model_change 的实证形态)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsCollectFiles: vi.fn(),
  fsReadTailChanged: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsCollectFiles: mocks.fsCollectFiles,
    fsReadTailChanged: mocks.fsReadTailChanged,
  },
}));

import { readJsonlSessionStatus } from "./sessionStatus";

const MODEL_KEYS = ["model", "modelId"] as const;
const PROVIDER_KEYS = ["provider"] as const;
const FILE = { name: "abc-session.jsonl", path: "/dir/abc-session.jsonl", modifiedAt: 1 };

function setup(files: { name: string; path: string; modifiedAt: number }[], tail: string) {
  mocks.fsCollectFiles.mockResolvedValue(files);
  mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: tail.length, text: tail });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("输入与文件定位", () => {
  it("目录扫描失败 → null", async () => {
    mocks.fsCollectFiles.mockRejectedValue(new Error("io"));
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toBeNull();
  });

  it("文件名不含 cliSessionId → null", async () => {
    setup([{ name: "other.jsonl", path: "/dir/other.jsonl", modifiedAt: 1 }], "ignored");
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toBeNull();
  });

  it("尾部读取失败或为空 → null", async () => {
    mocks.fsCollectFiles.mockResolvedValue([FILE]);
    mocks.fsReadTailChanged.mockRejectedValue(new Error("io"));
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toBeNull();

    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: 0, text: "" });
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toBeNull();
  });
});

describe("jsonl 尾部解析", () => {
  it("畸形行(截断 JSON)跳过,继续取更早的完整行", async () => {
    const tail = [
      JSON.stringify({ type: "model_change", model: "glm-5.2", provider: "zai" }),
      '{"type":"model_change","model":"TRUNCATED',
    ].join("\n");
    setup([FILE], tail);
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/glm-5.2",
      thinkingLevel: undefined,
    });
  });

  it("倒序优先级:最后一条 model_change / thinking_level_change 胜出", async () => {
    const tail = [
      JSON.stringify({ type: "model_change", model: "old-model", provider: "p1" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "low" }),
      JSON.stringify({ type: "model_change", model: "new-model", provider: "p2" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
    ].join("\n");
    setup([FILE], tail);
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "p2/new-model",
      thinkingLevel: "high",
    });
  });

  it("meta 等无关事件行被忽略,不影响状态提取", async () => {
    const tail = [
      JSON.stringify({ type: "session", id: "abc", timestamp: 123 }),
      JSON.stringify({ type: "model_change", model: "glm-5.2", provider: "zai" }),
      JSON.stringify({ type: "message", role: "user" }),
    ].join("\n");
    setup([FILE], tail);
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/glm-5.2",
      thinkingLevel: undefined,
    });
  });

  it("最近事件字段为空串时继续向更早事件回退", async () => {
    const tail = [
      JSON.stringify({ type: "model_change", model: "glm-5.2", provider: "zai" }),
      JSON.stringify({ type: "model_change", model: "", provider: "" }),
    ].join("\n");
    setup([FILE], tail);
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/glm-5.2",
      thinkingLevel: undefined,
    });
  });
  it("resume 无 model_change:最新 assistant message 的 model 胜出", async () => {
    // 实证自 ~/.omp 真实会话:14:32 model_change=kimi-code/k3 后 resume 恢复
    // MiniMax-M3 但未落事件,仅 assistant message 携带真实 model/provider。
    const tail = [
      JSON.stringify({ type: "model_change", model: "kimi-code/k3", role: "default" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", model: "MiniMax-M3", provider: "minimax-code-cn" },
      }),
    ].join("\n");
    setup([FILE], tail);
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "high",
    });
  });

  it("message 缺 provider:由更早的同模型 model_change 全名补前缀", async () => {
    const tail = [
      JSON.stringify({ type: "model_change", model: "minimax-code-cn/MiniMax-M3" }),
      JSON.stringify({ type: "model_change", model: "kimi-code/k3" }),
      JSON.stringify({ type: "message", message: { role: "assistant", model: "MiniMax-M3" } }),
    ].join("\n");
    setup([FILE], tail);
    expect(
      (await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS))?.model,
    ).toBe("minimax-code-cn/MiniMax-M3");
  });

  it("message 裸 id 无前缀可补时保持裸 id;异模型旧事件不张冠李戴", async () => {
    const tail = [
      JSON.stringify({ type: "model_change", model: "kimi-code/k3", provider: "kimi-code" }),
      JSON.stringify({ type: "message", message: { role: "assistant", model: "MiniMax-M3" } }),
    ].join("\n");
    setup([FILE], tail);
    expect(
      (await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS))?.model,
    ).toBe("MiniMax-M3");
  });

  it("更新的 model_change 仍优先于更早的 assistant message", async () => {
    const tail = [
      JSON.stringify({ type: "message", message: { role: "assistant", model: "old-bare" } }),
      JSON.stringify({ type: "model_change", model: "new-model", provider: "p2" }),
    ].join("\n");
    setup([FILE], tail);
    expect(
      (await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS))?.model,
    ).toBe("p2/new-model");
  });
});

describe("model/provider 拼接与 key 优先级", () => {
  it("裸 model 拼成 provider/model;已含 / 的 model 不再拼", async () => {
    setup(
      [FILE],
      JSON.stringify({ type: "model_change", model: "glm-5.2", provider: "zai" }),
    );
    expect(
      (await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS))?.model,
    ).toBe("zai/glm-5.2");

    setup(
      [FILE],
      JSON.stringify({ type: "model_change", model: "openai/gpt-5", provider: "p" }),
    );
    expect(
      (await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS, PROVIDER_KEYS))?.model,
    ).toBe("openai/gpt-5");
  });

  it("modelKeys 按声明顺序取第一个非空字段", async () => {
    setup(
      [FILE],
      JSON.stringify({ type: "model_change", modelId: "fallback-model" }),
    );
    expect(
      (await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS))?.model,
    ).toBe("fallback-model");
  });

  it("providerKeys 为空:无 provider 也能返回裸 model", async () => {
    setup([FILE], JSON.stringify({ type: "model_change", model: "glm-5.2" }));
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toEqual({
      model: "glm-5.2",
      thinkingLevel: undefined,
    });
  });

  it("只有 thinkingLevel 没有 model 也返回;两者皆无 → null", async () => {
    setup(
      [FILE],
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "max" }),
    );
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toEqual({
      model: undefined,
      thinkingLevel: "max",
    });

    setup([FILE], JSON.stringify({ type: "message", role: "user" }));
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toBeNull();

    // 嵌套 message 但非 assistant(用户消息不携带生效模型)→ 同样不算信号
    setup(
      [FILE],
      JSON.stringify({ type: "message", message: { role: "user", model: "x" } }),
    );
    expect(await readJsonlSessionStatus("/dir", "abc", MODEL_KEYS)).toBeNull();
  });
});

describe("尺寸闸(提案 2026-09-18-perf-status-poll)", () => {
  const GATE_FILE = { name: "abc-session.jsonl", path: "/gate/abc-session.jsonl", modifiedAt: 1 };
  const tailOf = (model: string) =>
    JSON.stringify({ type: "model_change", model, provider: "zai" });

  it("尺寸未变:短路返回缓存解析,免列目录免读", async () => {
    mocks.fsCollectFiles.mockResolvedValue([GATE_FILE]);
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: 100, text: tailOf("m1") });
    expect(await readJsonlSessionStatus("/gate", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/m1",
      thinkingLevel: undefined,
    });

    mocks.fsCollectFiles.mockRejectedValue(new Error("短路拍不该列目录"));
    mocks.fsReadTailChanged.mockResolvedValue({ changed: false, size: 100, text: "" });
    expect(await readJsonlSessionStatus("/gate", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/m1",
      thinkingLevel: undefined,
    });
  });

  it("尺寸变:走全路径刷新解析产物", async () => {
    mocks.fsCollectFiles.mockResolvedValue([GATE_FILE]);
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: 100, text: tailOf("m1") });
    await readJsonlSessionStatus("/gate2", "abc", MODEL_KEYS, PROVIDER_KEYS);

    mocks.fsCollectFiles.mockResolvedValue([GATE_FILE]);
    mocks.fsReadTailChanged
      .mockResolvedValueOnce({ changed: true, size: 180, text: "" }) // 探测拍判变
      .mockResolvedValueOnce({ changed: true, size: 180, text: tailOf("m2") });
    expect(await readJsonlSessionStatus("/gate2", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/m2",
      thinkingLevel: undefined,
    });
  });

  it("探测失败(文件被移走):回落全路径自愈", async () => {
    mocks.fsCollectFiles.mockResolvedValue([GATE_FILE]);
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: 100, text: tailOf("m1") });
    await readJsonlSessionStatus("/gate3", "abc", MODEL_KEYS, PROVIDER_KEYS);

    mocks.fsReadTailChanged
      .mockRejectedValueOnce(new Error("文件消失")) // 探测拍失败
      .mockResolvedValueOnce({ changed: true, size: 140, text: tailOf("m9") });
    expect(await readJsonlSessionStatus("/gate3", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/m9",
      thinkingLevel: undefined,
    });
  });

  it("文件消失出列:清缓存,后续走全路径", async () => {
    mocks.fsCollectFiles.mockResolvedValue([GATE_FILE]);
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: 100, text: tailOf("m1") });
    await readJsonlSessionStatus("/gate4", "abc", MODEL_KEYS, PROVIDER_KEYS);

    mocks.fsCollectFiles.mockResolvedValue([]); // 文件没了
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: 200, text: "" });
    expect(await readJsonlSessionStatus("/gate4", "abc", MODEL_KEYS, PROVIDER_KEYS)).toBeNull();

    // 文件回来:同键重新建缓存(旧条目已删,不会拿陈旧短路)
    mocks.fsCollectFiles.mockResolvedValue([GATE_FILE]);
    mocks.fsReadTailChanged
      .mockResolvedValueOnce({ changed: true, size: 260, text: tailOf("m7") });
    expect(await readJsonlSessionStatus("/gate4", "abc", MODEL_KEYS, PROVIDER_KEYS)).toEqual({
      model: "zai/m7",
      thinkingLevel: undefined,
    });
  });
});
