/**
 * pi 家族转录行型测试 —— 侊本取自本机 ~/.pi/agent/sessions 真实行(2026-09-28):
 * message 行 role=user/assistant/toolResult;assistant parts thinking/toolCall/text。
 */

import { describe, expect, it } from "vitest";
import { piTranscriptLine } from "./piTranscript";
import { pairToolResults, parseTranscriptBlocks } from "./sessionTranscript";

describe("piTranscriptLine", () => {
  it("user 行 → user 块;XML 包装过滤", () => {
    const blocks = piTranscriptLine({
      type: "message",
      id: "m1",
      timestamp: "2026-09-01T12:52:12.037Z",
      message: { role: "user", content: [{ type: "text", text: "帮我写文档" }] },
    });
    expect(blocks).toEqual([
      { id: "m1", role: "user", text: "帮我写文档", startedAt: Date.parse("2026-09-01T12:52:12.037Z") },
    ]);
    expect(
      piTranscriptLine({
        type: "message",
        id: "m2",
        message: { role: "user", content: [{ type: "text", text: "<command-name>/x</command-name>" }] },
      }),
    ).toEqual([]);
  });

  it("assistant parts:thinking → reasoning;toolCall → tool 块(shell 预览);text → assistant", () => {
    const blocks = piTranscriptLine({
      type: "message",
      id: "m3",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先看目录" },
          { type: "toolCall", id: "call_x", name: "shell", arguments: { command: "ls -la /docs/" } },
          { type: "text", text: "完成 ✅" },
        ],
      },
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ role: "reasoning", text: "先看目录" });
    expect(blocks[1]).toMatchObject({
      role: "tool",
      tool: { callId: "call_x", title: "shell", preview: { kind: "shell", output: "ls -la /docs/" } },
    });
    expect(blocks[2]).toMatchObject({ role: "assistant", text: "完成 ✅" });
  });

  it("toolResult 行与 toolCall 块按 callId 配对", () => {
    const text = [
      JSON.stringify({
        type: "message",
        id: "m4",
        message: { role: "assistant", content: [{ type: "toolCall", id: "c9", name: "shell", arguments: { command: "git st" } }] },
      }),
      JSON.stringify({
        type: "message",
        id: "m5",
        message: { role: "toolResult", toolCallId: "c9", toolName: "shell", content: [{ type: "text", text: " M src/a.ts" }] },
      }),
    ].join("\n");
    const blocks = pairToolResults(parseTranscriptBlocks(text, piTranscriptLine));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tool?.status).toBe("done");
    expect(blocks[0].tool?.detail).toBe(" M src/a.ts");
  });
});
