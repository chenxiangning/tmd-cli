/**
 * dsh-project 契约:mux 帧 → 动作投影的线格式锁(0.1.2 typert gateway):
 * follow 流 event 内层词表(chunk 形状、turn/end 成败判据、tool/call 与
 * tool/result 提取)、snapshot 快照透传、$events waterfall 审批/提问
 * (eventId 即应答键)、events-ready 登记 clientId。
 */

import { describe, expect, it } from "vitest";
import { projectFrame } from "./dsh-project.cjs";

/** follow 流事件帧:value = {type:"event", event}。 */
const followEvent = (event: unknown) => projectFrame({ type: "event", event }, "follow", "s1");

describe("follow 流:会话事件投影", () => {
  it("assistant/message:text 块出正文(0.1.5 真 turn 抓帧,整消息沉降)", () => {
    /* 真机帧:host 0.1.5-rc.1 follow 流,模型=qwen3.7-max,回复「收到」。 */
    const text = followEvent({
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { role: "assistant", content: [
        { type: "text", text: "收到" },
      ], source: { kind: "model", provider: "qwen-token-plan-cn", model: "qwen3.7-max" } } },
    });
    expect(text).toEqual([{ sid: "s1", kind: "text", text: "收到" }]);
  });

  it("assistant/message:reasoning 块出思考,tool-call 块不投影(走 tool/call)", () => {
    const out = followEvent({
      type: "assistant/message",
      data: { message: { role: "assistant", content: [
        { type: "reasoning", text: "想一下" },
        { type: "text", text: "正文" },
        { type: "tool-call", id: "c1", name: "bash" },
      ] } },
    });
    expect(out).toEqual([
      { sid: "s1", kind: "reasoning", text: "想一下" },
      { sid: "s1", kind: "text", text: "正文" },
    ]);
  });

  it("turn/end:reason.kind 判成败,error 取 message", () => {
    const ok = followEvent({ type: "turn/end", data: { reason: { kind: "completed" } } });
    expect(ok).toEqual([{ sid: "s1", kind: "turn-end", turnKind: "completed", error: null }]);
    const bad = followEvent({
      type: "turn/end", data: { reason: { kind: "error" }, error: { message: "boom" } },
    });
    expect(bad).toEqual([{ sid: "s1", kind: "turn-end", turnKind: "error", error: "boom" }]);
  });

  it("snapshot:records/projections/header 原样透传(历史回放 + 实况种子)", () => {
    const records = [
      { type: "event", event: { type: "permission/preset", seq: 0, data: { preset: "workspace-write" } } },
    ];
    const out = projectFrame(
      {
        type: "snapshot",
        header: { id: "s1", cwd: "/ws", agentPreset: "standard" },
        cursor: 3,
        records,
        hasMore: false,
        projections: { asOfSeq: 3, values: { contextPressure: { pressureTokens: 9 } } },
      },
      "follow",
      "s1",
    );
    expect(out).toEqual([
      {
        sid: "s1",
        kind: "snapshot",
        records,
        header: { id: "s1", cwd: "/ws", agentPreset: "standard" },
        projections: { asOfSeq: 3, values: { contextPressure: { pressureTokens: 9 } } },
      },
    ]);
  });

  it("未识别帧与未知事件:投影为空(chunkrow/* 历史编码不投影)", () => {
    expect(projectFrame({ type: "chunkrow/text-chunks" }, "follow", "s1")).toEqual([]);
    expect(followEvent({ type: "step/start", data: {} })).toEqual([]);
    expect(projectFrame({ type: "event" }, "follow", "s1")).toEqual([]);
    expect(projectFrame({ type: "ready", clientId: "x" }, "follow", "s1")).toEqual([]);
  });

  it("tool/call:带 host 预格式化 view(title/locations)", () => {
    const out = followEvent({
      type: "tool/call", data: { callId: "c1", name: "read", arguments: '{"file_path":"/a/b.ts"}',
        view: { view: { card: "file", title: "Read b.ts", kind: "read", locations: [{ path: "/a/b.ts", line: 1 }] } } },
    });
    expect(out[0]).toMatchObject({ kind: "tool-start", id: "c1", name: "read", title: "Read b.ts",
      locations: [{ path: "/a/b.ts", line: 1 }] });
  });

  it("tool/result:从 message.content 嵌套 tool-result 提取文本并带 callId", () => {
    const out = followEvent({
      type: "tool/result", data: { message: { source: { kind: "tool", callId: "c1" },
        content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok" }] }] } },
    });
    expect(out).toEqual([{ sid: "s1", kind: "tool-result", id: "c1", name: null, output: "ok", error: null }]);
  });

  it("tool/result:isError 块判失败;read 的 XML 包装拆 <content> 正文", () => {
    const err = followEvent({
      type: "tool/result", data: { message: { source: { callId: "c2" }, content: [
        { type: "tool-result", isError: true, content: [{ type: "text", text: "boom" }] }] } },
    });
    expect(err[0]).toMatchObject({ kind: "tool-result", id: "c2", error: "boom" });
    const wrapped = followEvent({
      type: "tool/result", data: { message: { source: { callId: "c3" }, content: [
        { type: "text", text: "<path>/a/b</path>\n<type>file</type>\n<content>\n1: hi\n\n(End of file - total 1 lines)\n</content>" }] } },
    });
    expect(wrapped[0].output).toBe("1: hi");
  });

  it("assistant/message:data.usage 出 token 三键", () => {
    const usage = followEvent({
      type: "assistant/message",
      data: { message: { role: "assistant", content: [{ type: "text", text: "x" }] },
        usage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 99 } },
    });
    expect(usage).toEqual([
      { sid: "s1", kind: "text", text: "x" },
      { sid: "s1", kind: "usage", input: 10, output: 5, cached: 99 },
    ]);
  });

  it("turn/start 投影为轮次开帧", () => {
    expect(followEvent({ type: "turn/start", data: {} })).toEqual([{ sid: "s1", kind: "turn-start" }]);
  });
});

describe("$events 流:waterfall 投影", () => {
  it("approval/request:eventId 即应答键,sid 取 agentId", () => {
    const out = projectFrame(
      {
        type: "waterfall", event: "approval/request", eventId: "ev-1",
        agentId: "s1", request: { toolName: "Bash", reason: "需要执行 rm" },
      },
      "events",
      "other",
    );
    expect(out).toEqual([
      { sid: "s1", kind: "approval", eventId: "ev-1", toolName: "Bash", message: "需要执行 rm" },
    ]);
  });

  it("user-questions/request:questions 透传;无 eventId 丢弃", () => {
    const q = [{ id: "q1", header: "选哪个", options: [{ label: "A" }, { label: "B" }] }];
    const out = projectFrame(
      { type: "waterfall", event: "user-questions/request", eventId: "ev-2", agentId: "s1", request: { questions: q } },
      "events",
      "other",
    );
    expect(out).toEqual([{ sid: "s1", kind: "question", eventId: "ev-2", questions: q }]);
    expect(
      projectFrame({ type: "waterfall", event: "user-questions/request", agentId: "s1", request: { questions: q } }, "events", "s1"),
    ).toEqual([]);
  });

  it("ready:clientId 交消费侧登记(应答需要)", () => {
    expect(projectFrame({ type: "ready", clientId: "cli-9", host: { home: "/h" } }, "events", "s1"))
      .toEqual([{ sid: null, kind: "events-ready", clientId: "cli-9" }]);
  });

  it("未知 waterfall 事件:投影为空", () => {
    expect(projectFrame({ type: "waterfall", event: "other/request", eventId: "e", agentId: "s1", request: {} }, "events", "s1")).toEqual([]);
  });
});
