/**
 * groupTurns 归组回归(spec 2026-09-25-mobile-session-render):连续 tool 折叠
 * 为一条运行,user/assistant 切断归组,index 恒指回原 turns 下标。
 */
import { describe, expect, it } from "vitest";
import { groupTurns } from "./shared";
import type { TranscriptTurn } from "@kernel/transcript";

const user = (text: string): TranscriptTurn => ({ role: "user", text });
const asst = (text: string): TranscriptTurn => ({ role: "assistant", text });
const tool = (text: string): TranscriptTurn => ({ role: "tool", tool: "shell", text });

describe("groupTurns 工具运行归组", () => {
  it("连续 tool 归组为一条 run,非 tool 逐条透传", () => {
    const segs = groupTurns([asst("a"), tool("ls"), tool("pwd"), asst("b")]);
    expect(segs).toEqual([
      { kind: "assistant", turn: asst("a"), index: 0 },
      { kind: "run", items: [tool("ls"), tool("pwd")], index: 1 },
      { kind: "assistant", turn: asst("b"), index: 3 },
    ]);
  });

  it("user 切断 run:两段工具各自成组", () => {
    const segs = groupTurns([tool("ls"), user("继续"), tool("pwd")]);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ kind: "run", index: 0 });
    expect(segs[1]).toMatchObject({ kind: "user", index: 1 });
    expect(segs[2]).toMatchObject({ kind: "run", index: 2 });
  });

  it("空输入 → 空分段;单条 tool 也成组", () => {
    expect(groupTurns([])).toEqual([]);
    expect(groupTurns([tool("ls")])).toEqual([
      { kind: "run", items: [tool("ls")], index: 0 },
    ]);
  });
});
