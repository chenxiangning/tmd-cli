/**
 * grok 转录行型测试 —— 侊本取自本机 ~/.grok/sessions chat_history.jsonl 真实行
 * (2026-09-28):user_query 包裹提取 / assistant 字符串正文 / reasoning summary。
 */

import { describe, expect, it } from "vitest";
import { grokTranscriptLine } from "./grokTranscript";

describe("grokTranscriptLine", () => {
  it("user 行 <user_query> 包裹提取;无包裹(注入)跳过", () => {
    const blocks = grokTranscriptLine({
      type: "user",
      content: [
        { type: "text", text: "<user_info>OS: macos</user_info>\n<user_query>\n分析这个项目\n</user_query>" },
      ],
    });
    expect(blocks).toEqual([{ id: expect.stringMatching(/^u:/), role: "user", text: "分析这个项目" }]);
    expect(grokTranscriptLine({ type: "user", content: [{ type: "text", text: "<system-reminder>x" }] })).toEqual([]);
  });

  it("assistant 行 content 字符串 → assistant 块", () => {
    const blocks = grokTranscriptLine({
      type: "assistant",
      content: "湘宁大兄弟你好!",
      model_id: "grok-4.6-build",
    });
    expect(blocks).toEqual([{ id: expect.stringMatching(/^a:/), role: "assistant", text: "湘宁大兄弟你好!" }]);
  });

  it("reasoning 行 summary[].summary_text → reasoning 块;system 行跳过", () => {
    const blocks = grokTranscriptLine({
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "用户在打招呼" }],
      encrypted_content: "x",
    });
    expect(blocks).toEqual([{ id: expect.stringMatching(/^r:/), role: "reasoning", text: "用户在打招呼" }]);
    expect(grokTranscriptLine({ type: "system", content: "You are Grok" })).toEqual([]);
  });
});
