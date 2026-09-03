/**
 * grok 写入事件解析契约测试(审批线 events 归因第二信号源)。
 * 夹带形态实证自 2026-08 真实 updates.jsonl(~/.grok/sessions),非构造格式。
 */
import { describe, expect, it } from "vitest";
import { parseGrokEditEvents } from "./edits";

const CWD = "/Users/chenxiangning/code/AI/github/codemoss";

// 实证:epoch 秒时间戳;x.ai/tool 自分类 kind=edit;路径在 rawInput.file_path
const EDIT_LINE =
  `{"timestamp":1787018186,"method":"session/update","params":{"sessionId":"s1",` +
  `"update":{"sessionUpdate":"tool_call","toolCallId":"call-9","title":"search_replace",` +
  `"rawInput":{"file_path":"${CWD}/docs/plans/plan.md","old_string":"a","new_string":"b"},` +
  `"_meta":{"x.ai/tool":{"version":1,"name":"search_replace","kind":"edit","namespace":"grok_build"}}}}}`;

const WRITE_LINE =
  `{"timestamp":1787018200,"method":"session/update","params":{"sessionId":"s1",` +
  `"update":{"sessionUpdate":"tool_call","toolCallId":"call-10","title":"write",` +
  `"rawInput":{"file_path":"${CWD}/docs/README.md","content":"x"},` +
  `"_meta":{"x.ai/tool":{"version":1,"name":"write","kind":"edit","namespace":"grok_build"}}}}}`;

const READ_LINE =
  `{"timestamp":1787018190,"method":"session/update","params":{"sessionId":"s1",` +
  `"update":{"sessionUpdate":"tool_call","toolCallId":"call-11","title":"read_file",` +
  `"rawInput":{"target_file":"${CWD}/docs/plans/plan.md"},` +
  `"_meta":{"x.ai/tool":{"version":1,"name":"read_file","kind":"read","namespace":"grok_build"}}}}}`;

describe("parseGrokEditEvents", () => {
  it("kind=edit 的 tool_call:rawInput.file_path 相对化,秒级 ts ×1000", () => {
    expect(parseGrokEditEvents(EDIT_LINE, 0, CWD)).toEqual([
      { path: "docs/plans/plan.md", ts: 1787018186000 },
    ]);
  });

  it("write 同为 edit 类;read_file 不产生事件", () => {
    const both = `${READ_LINE}\n${WRITE_LINE}`;
    expect(parseGrokEditEvents(both, 0, CWD)).toEqual([
      { path: "docs/README.md", ts: 1787018200000 },
    ]);
  });

  it("水位线增量:只返回晚于水位线的事件", () => {
    const both = `${EDIT_LINE}\n${WRITE_LINE}`;
    expect(parseGrokEditEvents(both, 1787018186000, CWD)).toEqual([
      { path: "docs/README.md", ts: 1787018200000 },
    ]);
    expect(parseGrokEditEvents(both, 0, CWD)).toHaveLength(2);
  });
});
