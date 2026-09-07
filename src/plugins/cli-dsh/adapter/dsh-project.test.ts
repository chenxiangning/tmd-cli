/**
 * dsh-project 契约:mux 帧 → 动作投影的线格式锁(codemoss events.rs 同款):
 * server-request 信封解包、session/event 内层类型、chunk 形状、turn/end
 * 成败判据、approval/question 的 rpcId 取外层。
 */

import { describe, expect, it } from "vitest";
import { projectFrame } from "./dsh-project.cjs";

describe("mux 帧投影", () => {
  it("server-request 信封:解包 payload,rpcId 取外层", () => {
    const out = projectFrame({
      type: "server-request",
      rpcId: "rpc-1",
      payload: { type: "approval/requested", sessionId: "s1", approvalId: "a1", toolName: "Bash" },
    });
    expect(out).toEqual([
      { sid: "s1", kind: "approval", rpcId: "rpc-1", approvalId: "a1", toolName: "Bash", message: "" },
    ]);
  });

  it("assistant/chunk:text-delta 出文本,reasoning-delta 出思考", () => {
    const text = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "你好" } } },
    });
    expect(text).toEqual([{ sid: "s1", kind: "text", text: "你好" }]);
    const reason = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "assistant/chunk", data: { chunk: { type: "reasoning-delta", text: "想" } } },
    });
    expect(reason).toEqual([{ sid: "s1", kind: "reasoning", text: "想" }]);
  });

  it("turn/end:reason.kind 判成败,error 取 message", () => {
    const ok = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "turn/end", data: { reason: { kind: "completed" } } },
    });
    expect(ok).toEqual([{ sid: "s1", kind: "turn-end", turnKind: "completed", error: null }]);
    const bad = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "turn/end", data: { reason: { kind: "error" }, error: { message: "boom" } } },
    });
    expect(bad).toEqual([{ sid: "s1", kind: "turn-end", turnKind: "error", error: "boom" }]);
  });

  it("question/requested:questions 数组透传,无 rpcId 丢弃", () => {
    const q = [{ id: "q1", header: "选哪个", options: [{ label: "A" }, { label: "B" }] }];
    const out = projectFrame({ type: "question/requested", rpcId: "r2", sessionId: "s1", questions: q });
    expect(out).toEqual([{ sid: "s1", kind: "question", rpcId: "r2", questions: q }]);
    expect(projectFrame({ type: "question/requested", sessionId: "s1", questions: q })).toEqual([]);
  });

  it("未识别帧与跨会话帧:投影为空/由消费侧过滤", () => {
    expect(projectFrame({ type: "session/subscribed", sessionId: "s1" })).toEqual([]);
    expect(projectFrame({ type: "session/event", sessionId: "s1", event: { type: "step/start", data: {} } })).toEqual([]);
  });

  it("tool/call:带 host 预格式化 view(title/locations)", () => {
    const out = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "tool/call", data: { callId: "c1", name: "read", arguments: '{"file_path":"/a/b.ts"}',
        view: { view: { card: "file", title: "Read b.ts", kind: "read", locations: [{ path: "/a/b.ts", line: 1 }] } } } },
    });
    expect(out[0]).toMatchObject({ kind: "tool-start", id: "c1", name: "read", title: "Read b.ts",
      locations: [{ path: "/a/b.ts", line: 1 }] });
  });

  it("tool/result:从 message.content 嵌套 tool-result 提取文本并带 callId", () => {
    const out = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "tool/result", data: { message: { source: { kind: "tool", callId: "c1" },
        content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok" }] }] } } },
    });
    expect(out).toEqual([{ sid: "s1", kind: "tool-result", id: "c1", name: null, output: "ok", error: null }]);
  });

  it("tool/result:isError 块判失败;read 的 XML 包装拆 <content> 正文", () => {
    const err = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "tool/result", data: { message: { source: { callId: "c2" }, content: [
        { type: "tool-result", isError: true, content: [{ type: "text", text: "boom" }] }] } } },
    });
    expect(err[0]).toMatchObject({ kind: "tool-result", id: "c2", error: "boom" });
    const wrapped = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "tool/result", data: { message: { source: { callId: "c3" }, content: [
        { type: "text", text: "<path>/a/b</path>\n<type>file</type>\n<content>\n1: hi\n\n(End of file - total 1 lines)\n</content>" }] } } },
    });
    expect(wrapped[0].output).toBe("1: hi");
  });

  it("assistant/chunk:tool-call-delta 出参数流,usage 出 token 三键", () => {
    const delta = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "assistant/chunk", data: { chunk: { type: "tool-call-delta", id: "c1", name: "bash", argumentsDelta: '{"command":' } } },
    });
    expect(delta).toEqual([{ sid: "s1", kind: "tool-delta", id: "c1", name: "bash", delta: '{"command":' }]);
    const usage = projectFrame({
      type: "session/event", sessionId: "s1",
      event: { type: "assistant/chunk", data: { chunk: { type: "usage", usage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 99 } } } },
    });
    expect(usage).toEqual([{ sid: "s1", kind: "usage", input: 10, output: 5, cached: 99 }]);
  });

  it("turn/start 投影为轮次开帧", () => {
    expect(projectFrame({ type: "session/event", sessionId: "s1", event: { type: "turn/start", data: {} } }))
      .toEqual([{ sid: "s1", kind: "turn-start" }]);
  });
});
