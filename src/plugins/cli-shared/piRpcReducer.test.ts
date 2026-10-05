/**
 * pi 族 RPC reducer 测试:帧序取自 omp 18.4.4/18.6.0 真机探针(18.6 轮界更名 turn_start,轮末新增 turn_end)
 * (typert 信封;子类型在 assistantMessageEvent;工具走顶层 tool_execution_* 帧)。
 */
import { describe, expect, it } from "vitest";
import { PiRpcReducer } from "./piRpcReducer";
import type { CliTranscriptBlock } from "@kernel/cliSessionTypes";

function frame(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, ...extra };
}

function msgStart(role: string, content: unknown[] = []) {
  return frame("message_start", { message: { role, content } });
}

function msgEnd(role: string, content: unknown[]) {
  return frame("message_end", { message: { role, content } });
}

function delta(kind: string, d: string) {
  return frame("message_update", { assistantMessageEvent: { type: kind, delta: d } });
}

function toolExec(type: string, id: string, extra: Record<string, unknown> = {}) {
  return frame(type, { toolCallId: id, toolName: "bash", args: { command: "echo hi" }, ...extra });
}

function roleSeq(blocks: CliTranscriptBlock[]): string {
  return blocks.map((b) => (b.role === "tool" ? `tool:${b.tool?.status}` : b.role)).join(",");
}

describe("PiRpcReducer(轮级工具行 + 流内 think/text)", () => {
  it("用户回显:占位 → message_end 落定权威文本", () => {
    const r = new PiRpcReducer();
    r.feed(msgStart("user"));
    const mid = r.feed(frame("message_update", {}));
    expect(mid.filter((b) => b.role === "user").map((b) => b.text)).toEqual([""]);
    r.feed(msgEnd("user", [{ type: "text", text: "构建项目" }]));
    const user = r.feed(frame("session_settled")).find((b) => b.role === "user");
    expect(user?.text).toBe("构建项目");
  });

  it("18.6 帧序:turn_start 推进轮界,无 session_start 也不滞留", () => {
    const r = new PiRpcReducer();
    r.feed(frame("agent_start"));
    r.feed(frame("turn_start"));
    r.feed(msgStart("user"));
    r.feed(msgEnd("user", [{ type: "text", text: "在吗" }]));
    expect(r.turnStart).toBe(0); // 用户回显仍在活轮段(LiveTurn 渲染)
    r.feed(msgStart("assistant"));
    r.feed(delta("text_delta", "在"));
    r.feed(frame("turn_end")); // 18.6 轮末同义帧,忽略(结算走 session_settled)
    r.feed(frame("agent_end"));
    r.feed(frame("session_settled"));
    expect(r.turnStart).toBe(2); // user+assistant 已落定
    r.feed(frame("agent_start"));
    r.feed(frame("turn_start")); // 第二轮轮界照常推进
    expect(r.turnStart).toBe(2);
  });

  it("assistant 流:thinking/text delta 原地累积,live 块 id 稳定", () => {
    const r = new PiRpcReducer();
    r.feed(msgStart("assistant"));
    const b1 = r.feed(delta("thinking_delta", "读"));
    const b2 = r.feed(delta("thinking_delta", "配置"));
    expect(b1.find((b) => b.role === "reasoning")?.text).toBe("读");
    expect(b2.find((b) => b.role === "reasoning")?.text).toBe("读配置");
    const b3 = r.feed(delta("text_delta", "答案"));
    expect(b3.find((b) => b.role === "assistant")?.text).toBe("答案");
  });

  it("工具律(真机帧序):msg1 end → exec start/update/end → msg2 流;running 行带实时输出,done 折叠态,无重复行", () => {
    const r = new PiRpcReducer();
    r.feed(frame("agent_start"));
    r.feed(msgStart("user"));
    r.feed(msgEnd("user", [{ type: "text", text: "跑" }]));
    /* assistant#1:思考流 → 落定(content 含 toolCall 项,须被滤除) */
    r.feed(msgStart("assistant"));
    r.feed(delta("thinking_delta", "先跑 echo"));
    r.feed(msgEnd("assistant", [
      { type: "thinking", thinking: "先跑 echo" },
      { type: "toolCall", toolCallId: "c1", toolName: "bash" },
    ]));
    /* 工具执行帧(消息已 end,轮级行仍须活) */
    let blocks = r.feed(toolExec("tool_execution_start", "c1"));
    expect(roleSeq(blocks)).toBe("user,reasoning,tool:running");
    blocks = r.feed(toolExec("tool_execution_update", "c1", { partialResult: { content: [{ type: "text", text: "hi\n" }] } }));
    expect(blocks.find((b) => b.role === "tool")?.tool?.detail).toBe("hi\n");
    blocks = r.feed(toolExec("tool_execution_update", "c1", { partialResult: { content: [{ type: "text", text: "hi\nWall time" }] } }));
    expect(blocks.find((b) => b.role === "tool")?.tool?.detail).toBe("hi\nWall time");
    blocks = r.feed(toolExec("tool_execution_end", "c1", { result: { content: [{ type: "text", text: "hi\nWall time" }] } }));
    expect(blocks.find((b) => b.role === "tool")?.tool?.status).toBe("done");
    /* toolResult 消息(role=toolResult)不产生块 —— 否则双行重复 */
    r.feed(msgStart("toolResult"));
    blocks = r.feed(msgEnd("toolResult", [{ type: "text", text: "hi" }]));
    expect(blocks.filter((b) => b.role === "tool")).toHaveLength(1);
    /* assistant#2 流:正文增量 */
    r.feed(msgStart("assistant"));
    blocks = r.feed(delta("text_delta", "输出是 hi"));
    expect(roleSeq(blocks)).toBe("user,reasoning,tool:done,assistant");
    /* 结算:权威落定 + 轮界推进,活轮切分归位 */
    blocks = r.feed(frame("session_settled"));
    expect(r.turnStart).toBe(blocks.length);
    expect(roleSeq(blocks)).toBe("user,reasoning,tool:done,assistant");
  });

  it("error 工具带病终态;多轮顺序累积不被扰动", () => {
    const r = new PiRpcReducer();
    r.feed(frame("agent_start"));
    r.feed(msgStart("user"));
    r.feed(msgEnd("user", [{ type: "text", text: "q" }]));
    r.feed(msgStart("assistant"));
    r.feed(toolExec("tool_execution_start", "e1"));
    r.feed(toolExec("tool_execution_end", "e1", { isError: true, result: { content: [{ type: "text", text: "boom" }] } }));
    expect(r.feed(frame("message_update", {})).find((b) => b.role === "tool")?.tool?.status).toBe("error");
    const before = r.feed(frame("session_settled"));
    /* 第二轮:前轮块原样保留,新流内块追加其后 */
    r.feed(frame("agent_start"));
    r.feed(msgStart("user"));
    r.feed(msgEnd("user", [{ type: "text", text: "again" }]));
    r.feed(msgStart("assistant"));
    r.feed(delta("text_delta", "二轮"));
    const after = r.feed(frame("message_update", {}));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
  });
});
