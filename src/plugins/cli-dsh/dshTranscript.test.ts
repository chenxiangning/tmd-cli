/**
 * dsh 转录行型测试 —— 侊本取自本机 ~/.dsh/sessions zstd 解压后真实行(2026-09-28):
 * user/message(source.kind 门控)/assistant/message parts/tool-call/
 * tool/result 嵌套 content。
 */

import { describe, expect, it } from "vitest";
import { dshTranscriptLine } from "./dshTranscript";
import { pairToolResults, parseTranscriptBlocks } from "../cli-shared/sessionTranscript";

describe("dshTranscriptLine", () => {
  it("user/message source.kind=user → user 块;plugin 播报跳过", () => {
    const blocks = dshTranscriptLine({
      type: "user/message",
      seq: 15,
      time: 1787648514901,
      data: {
        content: [{ type: "text", text: "项目分析" }],
        source: { kind: "user", rpcId: "r1" },
        role: "user",
        id: "b14424cd",
      },
    });
    expect(blocks).toEqual([
      { id: "b14424cd", role: "user", text: "项目分析", startedAt: 1787648514901 },
    ]);
    expect(
      dshTranscriptLine({
        type: "user/message",
        data: { content: [{ type: "text", text: "审批策略已变更" }], source: { kind: "plugin", plugin: "user-approval" } },
      }),
    ).toEqual([]);
  });

  it("assistant/message parts:text → assistant;tool-call → tool 块;与 tool/result 配对", () => {
    const text = [
      JSON.stringify({
        type: "assistant/message",
        time: 2,
        data: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I'll analyze the project." },
              { type: "tool-call", id: "call_1", name: "bash" },
            ],
          },
        },
      }),
      JSON.stringify({
        type: "tool/call",
        time: 3,
        data: { callId: "call_1", name: "bash", arguments: '{"command":"ls -la /"}' },
      }),
      JSON.stringify({
        type: "tool/result",
        time: 4,
        data: {
          message: {
            source: { kind: "tool", callId: "call_1" },
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                content: [{ type: "text", text: "bin etc" }],
              },
            ],
          },
        },
      }),
    ].join("\n");
    const blocks = pairToolResults(parseTranscriptBlocks(text, dshTranscriptLine));
    /* tool-call part 块(无 arguments → 无 shell 预览)与 tool/call 块同 callId:
       先到的 part 块被 tool/call 块顶替配对,assistant 文本块 + 合并工具块。 */
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ role: "assistant", text: "I'll analyze the project." });
    const done = blocks.find((b) => b.role === "tool" && b.tool?.status === "done");
    expect(done?.tool).toMatchObject({ callId: "call_1", title: "bash", detail: "bin etc" });
  });
});
