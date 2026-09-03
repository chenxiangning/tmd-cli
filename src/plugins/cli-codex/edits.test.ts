/**
 * codex 写入事件解析契约测试(审批线 events 归因第二信号源)。
 * 夹带形态实证自 2026-04 真实 rollout JSONL(~/.codex/sessions),非构造格式。
 */
import { describe, expect, it } from "vitest";
import { parseCodexEditEvents } from "./edits";

const CWD = "/Users/chenxiangning/code/AI/github/tmd-cli";

const PATCH_CALL =
  `{"type":"response_item","timestamp":"2026-04-26T09:37:44.793Z","payload":{"type":"custom_tool_call",` +
  `"name":"apply_patch","call_id":"call_1",` +
  `"input":"*** Begin Patch\\n*** Update File: .trellis/workspace/chenxiangning/journal-6.md\\n@@\\n-old\\n+new\\n*** Add File: docs/notes.md\\n+hello\\n*** Delete File: src/old.ts\\n*** End Patch"}}`;

const EXEC_LINE =
  `{"type":"response_item","timestamp":"2026-04-26T09:37:45.000Z","payload":{"type":"custom_tool_call",` +
  `"name":"exec","input":"ls src"}}`;

describe("parseCodexEditEvents", () => {
  it("apply_patch:Update/Add/Delete 三类补丁头都算触碰,仓库相对路径直取", () => {
    expect(parseCodexEditEvents(PATCH_CALL, 0, CWD)).toEqual([
      { path: ".trellis/workspace/chenxiangning/journal-6.md", ts: Date.parse("2026-04-26T09:37:44.793Z") },
      { path: "docs/notes.md", ts: Date.parse("2026-04-26T09:37:44.793Z") },
      { path: "src/old.ts", ts: Date.parse("2026-04-26T09:37:44.793Z") },
    ]);
  });

  it("exec 等 shell 调用不产生事件;水位线增量生效", () => {
    const since = Date.parse("2026-04-26T09:37:44.794Z");
    expect(parseCodexEditEvents(`${PATCH_CALL}\n${EXEC_LINE}`, since, CWD)).toEqual([]);
    expect(parseCodexEditEvents(`${EXEC_LINE}\n${PATCH_CALL}`, 0, CWD)).toHaveLength(3);
  });
});
