/** splitLiveWindow 切分契约 —— 2026-11-06 spec:可见窗恒定最新 3 个过程块
 * 且必含思考;更早的收进折叠头。 */
import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import { splitLiveWindow } from "./ssLiveWindow";

const R = (id: string): CliTranscriptBlock => ({ id, role: "reasoning", text: "想" });
const T = (id: string): CliTranscriptBlock => ({ id, role: "tool", text: "做" });
const ids = (bs: CliTranscriptBlock[]) => bs.map((b) => b.id);

describe("活轮过程窗切分", () => {
  it("不足 3 个不折", () => {
    const w = splitLiveWindow([R("r1"), T("t1")]);
    expect(w.head).toEqual([]);
    expect(ids(w.visible)).toEqual(["r1", "t1"]);
  });

  it("恰好 3 个不折", () => {
    const w = splitLiveWindow([R("r1"), T("t1"), T("t2")]);
    expect(w.head).toEqual([]);
    expect(ids(w.visible)).toEqual(["r1", "t1", "t2"]);
  });

  it("第 4 块出现:最老的折进头,最新 3 个可见(窗内已含思考)", () => {
    const w = splitLiveWindow([R("r1"), T("t1"), T("t2"), R("r2")]);
    expect(ids(w.head)).toEqual(["r1"]);
    expect(ids(w.visible)).toEqual(["t1", "t2", "r2"]);
  });

  it("工具连发挤出思考:换入最近思考,窗仍 3 个且原序保持", () => {
    /* R T1 | T2 T3 T4 → 默认窗 [T2,T3,T4] 无思考,挤出 T2 换入 R。 */
    const w = splitLiveWindow([R("r1"), T("t1"), T("t2"), T("t3"), T("t4")]);
    expect(ids(w.head)).toEqual(["t1", "t2"]);
    expect(ids(w.visible)).toEqual(["r1", "t3", "t4"]);
  });

  it("轮内无任何思考:约束不触发,窗 = 最新 3 个工具", () => {
    const w = splitLiveWindow([T("t1"), T("t2"), T("t3"), T("t4"), T("t5")]);
    expect(ids(w.head)).toEqual(["t1", "t2"]);
    expect(ids(w.visible)).toEqual(["t3", "t4", "t5"]);
  });

  it("思考工具交错:混合计数,头在前窗在后", () => {
    const w = splitLiveWindow([T("t1"), R("r1"), T("t2"), R("r2"), T("t3"), R("r3")]);
    expect(ids(w.head)).toEqual(["t1", "r1", "t2"]);
    expect(ids(w.visible)).toEqual(["r2", "t3", "r3"]);
  });

  it("窗内已有思考:连发工具不再换入更老思考", () => {
    /* R1 T1 R2 | T2 T3 → 窗 [R2,T2,T3] 含思考,直接成立。 */
    const w = splitLiveWindow([R("r1"), T("t1"), R("r2"), T("t2"), T("t3")]);
    expect(ids(w.head)).toEqual(["r1", "t1"]);
    expect(ids(w.visible)).toEqual(["r2", "t2", "t3"]);
  });
});
