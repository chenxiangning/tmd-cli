/**
 * omp 写入事件解析契约测试(审批线 events 归因第二信号源)。
 * 夹带行实证自 2026-09-03 真实会话 JSONL(~/.omp/agent/sessions),非构造格式。
 */
import { describe, expect, it } from "vitest";
import { parseOmpEditEvents } from "./edits";

const CWD = "/Users/x/code/AI/github/tmd-cli";

const EDIT_LINE =
  `{"type":"message","id":"35aa1b0b","parentId":"53e88b44","timestamp":"2026-09-03T13:45:20.263Z",` +
  `"message":{"role":"toolResult","toolCallId":"call_98dda148","toolName":"edit",` +
  `"content":[{"type":"text","text":"[docs/learn-omp-cli/README.md#EB3B]\\n1:# omp CLI 学习笔记"}],` +
  `"details":{"diff":"+74|新增一行"}}}`;

const WRITE_LINE =
  `{"type":"message","id":"2304b8c2","parentId":"921d4d05","timestamp":"2026-09-03T13:47:16.476Z",` +
  `"message":{"role":"toolResult","toolCallId":"call_0aeb3eec","toolName":"write",` +
  `"content":[{"type":"text","text":"[docs/learn-omp-cli/01-basics.md#B040]\\nSuccessfully wrote 5300 bytes to docs/learn-omp-cli/01-basics.md"}],` +
  `"details":{"resolvedPath":"/Users/x/code/AI/github/tmd-cli/docs/learn-omp-cli/01-basics.md"}}}`;

const WRITE_NO_DETAILS =
  `{"type":"message","id":"2304b8d0","parentId":"921d4d05","timestamp":"2026-09-03T13:47:16.500Z",` +
  `"message":{"role":"toolResult","toolCallId":"call_0aeb3ef0","toolName":"write",` +
  `"content":[{"type":"text","text":"Successfully wrote 200 bytes to docs/a.md"}]}}`;

const READ_LINE =
  `{"type":"custom","customType":"tool_execution_start","data":{"toolCallId":"c1","toolName":"read",` +
  `"args":{"path":"docs/learn-omp-cli/README.md"}},"timestamp":"2026-09-03T13:29:49.877Z"}`;

const T0 = Date.parse("2026-09-03T13:45:00.000Z");

describe("parseOmpEditEvents", () => {
  it("edit 工具结果:hashline 快照头即写入路径,时刻取条目 timestamp", () => {
    expect(parseOmpEditEvents(EDIT_LINE, 0, CWD)).toEqual([
      { path: "docs/learn-omp-cli/README.md", ts: Date.parse("2026-09-03T13:45:20.263Z") },
    ]);
  });

  it("write 工具结果:details.resolvedPath 绝对路径按 cwd 相对化", () => {
    expect(parseOmpEditEvents(WRITE_LINE, 0, CWD)).toEqual([
      { path: "docs/learn-omp-cli/01-basics.md", ts: Date.parse("2026-09-03T13:47:16.476Z") },
    ]);
  });

  it("write 无 details:正文 Successfully wrote 兜底", () => {
    expect(parseOmpEditEvents(WRITE_NO_DETAILS, 0, CWD)).toEqual([
      { path: "docs/a.md", ts: Date.parse("2026-09-03T13:47:16.500Z") },
    ]);
  });

  it("read 等非写入工具与 custom 条目不产生事件", () => {
    expect(parseOmpEditEvents(READ_LINE, 0, CWD)).toEqual([]);
  });

  it("水位线增量:只返回 ts > sinceTs 的事件", () => {
    const both = [READ_LINE, EDIT_LINE, WRITE_LINE].join("\n");
    const since = Date.parse("2026-09-03T13:45:20.300Z");
    expect(parseOmpEditEvents(both, since, CWD)).toEqual([
      { path: "docs/learn-omp-cli/01-basics.md", ts: Date.parse("2026-09-03T13:47:16.476Z") },
    ]);
    expect(parseOmpEditEvents(both, T0, CWD)).toHaveLength(2);
  });

  it("尾窗截断坏行与非 JSON 行跳过,不影响后续行", () => {
    const broken = `{"type":"message","id":"cut,"timestamp":"2026-09-03T13:45:2\n${EDIT_LINE}`;
    expect(parseOmpEditEvents(broken, 0, CWD)).toHaveLength(1);
  });

  it("家目录缩写与逃逸路径拒绝(宁漏勿误)", () => {
    const hostile =
      `{"type":"message","timestamp":"2026-09-03T13:45:20.263Z","message":{"role":"toolResult",` +
      `"toolName":"edit","content":[{"type":"text","text":"[~/outside.md#AB12]\\n[../escape.md#AB13]"}]}}`;
    expect(parseOmpEditEvents(hostile, 0, CWD)).toEqual([]);
  });
});
