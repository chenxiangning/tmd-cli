/**
 * 转录骨架测试 —— 行循环坏行容错 / 工具配对 / 预览启发(2026-09-28 实证行型侊本)。
 */

import { describe, expect, it } from "vitest";
import {
  diffLinesFromStrings,
  pairToolResults,
  parseTranscriptBlocks,
  toolPreviewKindOf,
  type TranscriptLineParser,
} from "./sessionTranscript";

describe("parseTranscriptBlocks", () => {
  const lineOf: TranscriptLineParser = (event) =>
    event.type === "x" ? [{ id: "1", role: "user", text: "hi" }] : [];

  it("JSON 行产块;坏行与非 JSON 行跳过", () => {
    const blocks = parseTranscriptBlocks(
      '{"type":"x"}\nnot-json\n{"broken":\n\n{"type":"y"}',
      lineOf,
    );
    expect(blocks).toEqual([{ id: "1", role: "user", text: "hi" }]);
  });
});

describe("pairToolResults", () => {
  it("结果块并入同 callId 调用块(status=done + detail);孤儿结果保留", () => {
    const blocks = pairToolResults([
      { id: "a", role: "tool", text: "", tool: { callId: "c1", title: "bash", status: "called" } },
      { id: "b", role: "assistant", text: "ok" },
      { id: "c", role: "tool", text: "ls out", tool: { callId: "c1" } },
      { id: "d", role: "tool", text: "lonely", tool: { callId: "cX" } },
    ]);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].tool?.status).toBe("done");
    expect(blocks[0].tool?.detail).toBe("ls out");
    expect(blocks[2].text).toBe("lonely");
  });
});

describe("toolPreviewKindOf", () => {
  it("按工具名启发分类", () => {
    expect(toolPreviewKindOf("Bash")).toBe("shell");
    expect(toolPreviewKindOf("exec_command")).toBe("shell");
    expect(toolPreviewKindOf("Read")).toBe("read");
    expect(toolPreviewKindOf("Edit")).toBe("write");
    expect(toolPreviewKindOf("Grep")).toBe("search");
    expect(toolPreviewKindOf("unknown_tool")).toBeUndefined();
  });
});

describe("diffLinesFromStrings", () => {
  it("旧文 del 行在前,新文 add 行在后;双侧截断", () => {
    const lines = diffLinesFromStrings("a\nb", "c");
    expect(lines).toEqual([
      { kind: "del", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "c" },
    ]);
    expect(diffLinesFromStrings(undefined, undefined)).toBeUndefined();
  });
});
