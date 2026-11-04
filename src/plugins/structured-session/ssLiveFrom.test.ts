import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import { liveFromIndex } from "./ssLiveFrom";

const u = (id: string): CliTranscriptBlock => ({ id, role: "user", text: "q" });
const r = (id: string): CliTranscriptBlock => ({ id, role: "reasoning", text: "t" });

describe("liveFromIndex", () => {
  it("live 期 = 最后一个用户块下标(引擎中轮界帧推进也不错位)", () => {
    const blocks = [u("u1"), r("r1"), r("r2")];
    expect(liveFromIndex(blocks, 3, true)).toBe(0);
    expect(liveFromIndex(blocks, 2, true)).toBe(0);
  });
  it("多轮:最后用户块之后的本轮块全部归活轮", () => {
    const blocks = [u("u1"), r("r1"), u("u2"), r("r2")];
    expect(liveFromIndex(blocks, 4, true)).toBe(2);
  });
  it("落定 = turnStart(结算后全量落定,活轮切片为空)", () => {
    const blocks = [u("u1"), r("r1")];
    expect(liveFromIndex(blocks, 2, false)).toBe(2);
  });
  it("无用户块回退 turnStart(首帧未到窗口)", () => {
    expect(liveFromIndex([r("r1")], 1, true)).toBe(1);
    expect(liveFromIndex([], 0, true)).toBe(0);
  });
});
