/**
 * claude 家族转录行型测试 —— claude/qoder 变体(侊本取自本机 ~/.claude/projects
 * 真实行,2026-09-28):user(string/parts)/assistant(text/thinking/tool_use)/
 * tool_result 配对 / sidechain 跳过 / qoder origin 门控 / XML 包装过滤。
 */

import { describe, expect, it } from "vitest";
import { claudeTranscriptLine } from "./claudeTranscript";
import { pairToolResults, parseTranscriptBlocks } from "./sessionTranscript";

const claude = claudeTranscriptLine("claude");
const qoder = claudeTranscriptLine("qoder");

describe("claudeTranscriptLine", () => {
  it("user 行 content 字符串 → user 块;XML 包装过滤", () => {
    const blocks = claude({
      type: "user",
      uuid: "u1",
      timestamp: "2026-09-27T02:06:48.165Z",
      message: { role: "user", content: "你好" },
    });
    expect(blocks).toEqual([
      { id: "u1", role: "user", text: "你好", startedAt: Date.parse("2026-09-27T02:06:48.165Z") },
    ]);
    expect(
      claude({
        type: "user",
        uuid: "u2",
        message: { role: "user", content: "<system-reminder>x</system-reminder>" },
      }),
    ).toEqual([]);
  });

  it("user 图片 part 并入首个文本块;tool_result 信封不挂图;纯图片也成块", () => {
    const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } };
    const blocks = claude({
      type: "user",
      uuid: "u1i",
      timestamp: "2026-09-29T09:29:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "看截图" }, img] },
    });
    expect(blocks).toEqual([
      {
        id: "u1i#0",
        role: "user",
        text: "看截图",
        startedAt: Date.parse("2026-09-29T09:29:00.000Z"),
        images: [{ data: "aGk=", mimeType: "image/png" }],
      },
    ]);
    /* tool_result 信封(user 角色工具回包)不产出用户图片块。 */
    expect(
      claude({
        type: "user",
        uuid: "u2i",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, img] },
      }),
    ).toEqual([
      { id: "u2i#r0", role: "tool", text: "ok", tool: { callId: "t1" } },
    ]);
    expect(
      claude({
        type: "user",
        uuid: "u3i",
        message: { role: "user", content: [img] },
      }),
    ).toEqual([{ id: "u3i", role: "user", text: "", images: [{ data: "aGk=", mimeType: "image/png" }] }]);
  });

  it("assistant 行 parts 各自成块:text/thinking/tool_use(shell 预览)", () => {
    const blocks = claude({
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "想想" },
          { type: "text", text: "正文" },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ role: "reasoning", text: "想想" });
    expect(blocks[1]).toMatchObject({ role: "assistant", text: "正文" });
    expect(blocks[2]).toMatchObject({
      role: "tool",
      tool: { callId: "t1", title: "Bash", status: "called", preview: { kind: "shell", output: "ls -la" } },
    });
  });

  it("Edit 工具 → write 预览带 del/add 行", () => {
    const blocks = claude({
      type: "assistant",
      uuid: "a2",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "Edit",
            input: { file_path: "/x/a.ts", old_string: "a", new_string: "b" },
          },
        ],
      },
    });
    expect(blocks[0].tool?.preview).toEqual({
      kind: "write",
      path: "/x/a.ts",
      lines: [
        { kind: "del", text: "a" },
        { kind: "add", text: "b" },
      ],
    });
  });

  it("user 行 tool_result part → 结果块,与调用块配对合并", () => {
    const text = [
      JSON.stringify({
        type: "assistant",
        uuid: "a3",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "pwd" } }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u3",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t3", content: "/tmp" }],
        },
      }),
    ].join("\n");
    const blocks = pairToolResults(parseTranscriptBlocks(text, claude));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tool?.status).toBe("done");
    expect(blocks[0].tool?.detail).toBe("/tmp");
  });

  it("isSidechain 跳过;qoder 变体仅认 origin.kind=human", () => {
    const sidechain = { type: "user", uuid: "s1", isSidechain: true, message: { role: "user", content: "sub" } };
    expect(claude(sidechain as Record<string, unknown>)).toEqual([]);
    const human = { type: "user", uuid: "h1", origin: { kind: "human" }, message: { role: "user", content: "真人" } };
    const noOrigin = { type: "user", uuid: "h2", message: { role: "user", content: "注入" } };
    expect(qoder(human as Record<string, unknown>)).toHaveLength(1);
    expect(qoder(noOrigin as Record<string, unknown>)).toEqual([]);
    expect(claude(noOrigin as Record<string, unknown>)).toHaveLength(1);
  });
});
