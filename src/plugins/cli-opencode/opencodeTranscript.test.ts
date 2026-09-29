/**
 * opencode 转录行测试 —— 侊本按 db.ts 表结构知识构造(part/message JSON 形态,
 * 2026-09-28 实证):text 部件按 role 分块(user 滤包装)/tool 部件成工具卡。
 */

import { describe, expect, it } from "vitest";
import { opencodeTranscriptRows } from "./opencodeTranscript";

function row(rowid: number, role: string, data: unknown): unknown[] {
  return [rowid, role, JSON.stringify(data)];
}

describe("opencodeTranscriptRows", () => {
  it("text 部件:user 滤包装 / assistant 成块;其它 role 跳过", () => {
    const blocks = opencodeTranscriptRows([
      row(1, "user", { type: "text", text: "帮我重构" }),
      row(2, "user", { type: "text", text: "<system-reminder>x" }),
      row(3, "assistant", { type: "text", text: "开始重构" }),
      row(4, "system", { type: "text", text: "injected" }),
    ]);
    expect(blocks).toEqual([
      { id: "p1", role: "user", text: "帮我重构" },
      { id: "p3", role: "assistant", text: "开始重构" },
    ]);
  });

  it("tool 部件:名称/状态/write 路径预览;output 文本入块", () => {
    const blocks = opencodeTranscriptRows([
      row(5, "assistant", {
        type: "tool",
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "/x/a.ts" },
          output: "done",
          time: { start: 1, end: 2 },
        },
      }),
    ]);
    expect(blocks).toEqual([
      {
        id: "p5",
        role: "tool",
        text: "done",
        tool: { title: "edit", status: "completed", preview: { kind: "write", path: "/x/a.ts" } },
      },
    ]);
  });

  it("坏 JSON 行跳过;未实证形态(reasoning)宽容跳过", () => {
    const blocks = opencodeTranscriptRows([
      [9, "assistant", "{broken"],
      row(10, "assistant", { type: "reasoning", text: "思考" }),
    ]);
    expect(blocks).toEqual([]);
  });
});
