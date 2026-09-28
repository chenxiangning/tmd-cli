/**
 * kimi 转录行型测试 —— 侊本取自本机 ~/.kimi-code wire.jsonl 真实行(2026-09-28):
 * turn.prompt(origin.kind=user)/loop event content.part(think|text)/tool.call/tool.result。
 */

import { describe, expect, it } from "vitest";
import { kimiTranscriptLine } from "./kimiTranscript";
import { pairToolResults, parseTranscriptBlocks } from "../cli-shared/sessionTranscript";

describe("kimiTranscriptLine", () => {
  it("turn.prompt origin.kind=user → user 块;非 user origin 跳过", () => {
    const blocks = kimiTranscriptLine({
      type: "turn.prompt",
      promptId: "msg_1",
      input: [{ type: "text", text: "项目分析" }],
      origin: { kind: "user" },
      time: 1787648514901,
    });
    expect(blocks).toEqual([
      { id: "msg_1", role: "user", text: "项目分析", startedAt: 1787648514901 },
    ]);
    expect(
      kimiTranscriptLine({
        type: "turn.prompt",
        promptId: "msg_2",
        input: [{ type: "text", text: "plugin 播报" }],
        origin: { kind: "plugin" },
      }),
    ).toEqual([]);
  });

  it("loop event content.part:think → reasoning,text → assistant", () => {
    expect(
      kimiTranscriptLine({
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "cp1", part: { type: "think", think: "先分析结构" } },
        time: 1,
      }),
    ).toEqual([{ id: "cp1", role: "reasoning", text: "先分析结构", startedAt: 1 }]);
    expect(
      kimiTranscriptLine({
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "cp2", part: { type: "text", text: "项目有 15 个文件" } },
      }),
    ).toEqual([{ id: "cp2", role: "assistant", text: "项目有 15 个文件", startedAt: undefined }]);
  });

  it("tool.call 与 tool.result 按 toolCallId 配对;args.command 进 shell 预览", () => {
    const text = [
      JSON.stringify({
        type: "context.append_loop_event",
        event: { type: "tool.call", uuid: "tc1", toolCallId: "tool_K1", name: "bash", args: { command: "ls -la /srv/" } },
      }),
      JSON.stringify({
        type: "context.append_loop_event",
        event: {
          type: "tool.result",
          toolCallId: "tool_K1",
          result: { output: [{ type: "text", text: "total 8" }] },
        },
      }),
    ].join("\n");
    const blocks = pairToolResults(parseTranscriptBlocks(text, kimiTranscriptLine));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tool).toMatchObject({
      callId: "tool_K1",
      title: "bash",
      status: "done",
      detail: "total 8",
      preview: { kind: "shell", output: "ls -la /srv/" },
    });
  });
});
