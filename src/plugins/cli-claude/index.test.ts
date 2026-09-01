/**
 * cli-claude 插件纯函数测试:slug 编码与会话模型提取。
 * fixture 形状实证自本机 ~/.claude/projects/(claude 2.1.251)。
 */
import { describe, expect, it } from "vitest";
import { claudeProjectSlug, extractClaudeModel } from "./index";

describe("claudeProjectSlug", () => {
  it("常规路径:斜杠替换为 -,大小写保留", () => {
    expect(claudeProjectSlug("/Users/x/code/AI/github/mossx")).toBe(
      "-Users-x-code-AI-github-mossx",
    );
  });

  it("点号同样替换(实证 -Users-x--claude ↔ /Users/x/.claude)", () => {
    expect(claudeProjectSlug("/Users/x/.claude")).toBe("-Users-x--claude");
  });

  it("非 ASCII 每个字符一个 -(实证 /Users/x/code/内容分析 → -Users-x-code-----)", () => {
    expect(claudeProjectSlug("/Users/x/code/内容分析")).toBe(
      "-Users-x-code-----",
    );
  });

  it("home 根目录自身也有确定 slug", () => {
    expect(claudeProjectSlug("/Users/x")).toBe("-Users-x");
  });
});

describe("extractClaudeModel", () => {
  const assistant = (model: string) =>
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", model },
    });

  it("取尾部最后一条 assistant 行的 message.model", () => {
    const tail = [
      assistant("claude-sonnet-4-5"),
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
      assistant("k3"),
    ].join("\n");
    expect(extractClaudeModel(tail)).toBe("k3");
  });

  it("queue-operation 与 user 行无 model,被 type 守卫排除", () => {
    const tail = [
      assistant("k3"),
      JSON.stringify({
        type: "queue-operation",
        operation: "enqueue",
        sessionId: "6b844d1a-d84e-44c3-8385-1e1770d0ffb0",
      }),
    ].join("\n");
    expect(extractClaudeModel(tail)).toBe("k3");
  });

  it("尾部块首行截断时跳过,继续读完整行", () => {
    // fsReadTail 从中间切块,首行是半行 JSON
    const tail = `{"type":"assistant","message":{"mo\n${assistant("k3")}`;
    expect(extractClaudeModel(tail)).toBe("k3");
  });

  it("无 assistant 模型信息返回 undefined", () => {
    expect(extractClaudeModel("")).toBeUndefined();
    expect(
      extractClaudeModel(
        JSON.stringify({ type: "user", message: { role: "user" } }),
      ),
    ).toBeUndefined();
  });
});
