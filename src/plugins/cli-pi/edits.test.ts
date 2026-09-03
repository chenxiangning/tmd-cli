/**
 * pi 写入事件解析契约测试(审批线 events 归因第二信号源)。
 * 夹带行实证自 2026-09-02 真实会话 JSONL(~/.pi/agent/sessions),非构造格式。
 * 与 omp 的差异点:pi 上游 edit 是 str_replace 语义,路径在结果正文句末,无快照头。
 */
import { describe, expect, it } from "vitest";
import { parsePiEditEvents } from "./edits";

const CWD = "/Users/chenxiangning/code/AI/github/tmd-cli";

const EDIT_LINE =
  `{"type":"message","id":"aa8f2e1a","parentId":"a8a356c5","timestamp":"2026-09-02T02:43:25.927Z",` +
  `"message":{"role":"toolResult","toolCallId":"call_99ac7039465f7245","toolName":"edit",` +
  `"content":[{"type":"text","text":"Successfully replaced 1 block(s) in /Users/chenxiangning/code/AI/github/tmd-cli/.github/workflows/release.yml."},` +
  `{"type":"text","text":"⏳ Pending runners: lsp"}],"details":{"diff":" 22       matrix:"}}}`;

const WRITE_LINE =
  `{"type":"message","id":"b01c","timestamp":"2026-09-02T02:44:00.000Z",` +
  `"message":{"role":"toolResult","toolCallId":"call_x2","toolName":"write",` +
  `"content":[{"type":"text","text":"Successfully wrote 3160 bytes to /Users/chenxiangning/code/AI/github/tmd-cli/.github/workflows/release.yml"}]}}`;

const SHELL_LINE =
  `{"type":"message","id":"c02","timestamp":"2026-09-02T02:44:10.000Z",` +
  `"message":{"role":"toolResult","toolCallId":"call_x3","toolName":"ctx_shell",` +
  `"content":[{"type":"text","text":"Successfully replaced 9 block(s) in /tmp/x.ts."}]}}`;

const T0 = Date.parse("2026-09-02T02:43:00.000Z");

describe("parsePiEditEvents", () => {
  it("edit 工具结果:正文句末绝对路径,按 cwd 相对化(尾句点剥除)", () => {
    expect(parsePiEditEvents(EDIT_LINE, 0, CWD)).toEqual([
      { path: ".github/workflows/release.yml", ts: Date.parse("2026-09-02T02:43:25.927Z") },
    ]);
  });

  it("write 工具结果:无句点收尾同样可提取", () => {
    expect(parsePiEditEvents(WRITE_LINE, 0, CWD)).toEqual([
      { path: ".github/workflows/release.yml", ts: Date.parse("2026-09-02T02:44:00.000Z") },
    ]);
  });

  it("ctx_shell 等非写入工具即使正文形似也不产生事件", () => {
    expect(parsePiEditEvents(SHELL_LINE, 0, CWD)).toEqual([]);
  });

  it("水位线增量与坏行跳过", () => {
    const both = `{"type":"message",bad\n${EDIT_LINE}\n${WRITE_LINE}`;
    const since = Date.parse("2026-09-02T02:43:30.000Z");
    expect(parsePiEditEvents(both, since, CWD)).toEqual([
      { path: ".github/workflows/release.yml", ts: Date.parse("2026-09-02T02:44:00.000Z") },
    ]);
    expect(parsePiEditEvents(both, T0, CWD)).toHaveLength(2);
  });
});
