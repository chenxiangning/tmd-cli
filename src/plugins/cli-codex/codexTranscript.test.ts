/**
 * codex 转录行型测试 —— 侊本取自本机 ~/.codex/sessions 真实行(2026-09-28):
 * response_item payload message/function_call/function_call_output/reasoning;
 * developer 注入跳过;包装过滤。
 */

import { describe, expect, it } from "vitest";
import { codexTranscriptLine } from "./codexTranscript";
import { pairToolResults, parseTranscriptBlocks } from "../cli-shared/sessionTranscript";

describe("codexTranscriptLine", () => {
  it("payload message:user 真实输入与 assistant 输出成块;developer 跳过;包装过滤", () => {
    const user = codexTranscriptLine({
      type: "response_item",
      timestamp: "2026-09-10T06:05:10.000Z",
      payload: { type: "message", id: "msg1", role: "user", content: [{ type: "input_text", text: "检查项目" }] },
    });
    expect(user).toEqual([
      { id: "msg1", role: "user", text: "检查项目", startedAt: Date.parse("2026-09-10T06:05:10.000Z") },
    ]);
    const assistant = codexTranscriptLine({
      type: "response_item",
      payload: { type: "message", id: "msg2", role: "assistant", content: [{ type: "output_text", text: "看完了" }] },
    });
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({ role: "assistant", text: "看完了" });
    expect(
      codexTranscriptLine({
        type: "response_item",
        payload: { type: "message", id: "msg3", role: "developer", content: [{ type: "input_text", text: "<skills_instructions>" }] },
      }),
    ).toEqual([]);
    expect(
      codexTranscriptLine({
        type: "response_item",
        payload: { type: "message", id: "msg4", role: "user", content: [{ type: "input_text", text: "<system-reminder>x" }] },
      }),
    ).toEqual([]);
  });

  it("function_call + function_call_output 按 call_id 配对;arguments 解出 cmd", () => {
    const text = [
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          id: "fc1",
          name: "exec_command",
          arguments: '{"cmd": "ls -la", "justification": "检查"}',
          call_id: "cc1",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call_output", call_id: "cc1", output: "total 32" },
      }),
    ].join("\n");
    const blocks = pairToolResults(parseTranscriptBlocks(text, codexTranscriptLine));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tool).toMatchObject({
      callId: "cc1",
      title: "exec_command",
      status: "done",
      detail: "total 32",
      preview: { kind: "shell", output: "ls -la" },
    });
  });

  it("reasoning payload → reasoning 块", () => {
    const blocks = codexTranscriptLine({
      type: "response_item",
      payload: {
        type: "reasoning",
        id: "rs1",
        content: [{ type: "reasoning_text", text: "用户在问候" }],
      },
    });
    expect(blocks).toEqual([{ id: "rs1", role: "reasoning", text: "用户在问候", startedAt: undefined }]);
  });
});
