/**
 * matchTurnBatches 契约测试:单轮全等、同文多轮按出现序配对、批次不足不配、
 * 无匹配不配、空 prompt 批次不参与、乱序清单按 index 升序归位、git 归因透传。
 */
import { describe, expect, it } from "vitest";
import type { CkptBatch } from "@kernel/ipc";

import { matchTurnBatches } from "./turnMatch";

function batch(id: string, index: number, prompt: string, attribution: "events" | "git" = "events"): CkptBatch {
  return {
    id,
    index,
    open: false,
    ts: 0,
    tsEnd: null,
    sessionId: "cli-1",
    prompt,
    engine: "",
    model: "",
    thinking: "",
    state: "pending",
    doneReason: null,
    guardId: null,
    files: [],
    attribution,
    marksRefs: [],
  } as CkptBatch;
}

describe("matchTurnBatches", () => {
  it("同文多轮:第 k 条同文消息配第 k 个同文批次(index 升序)", () => {
    const batches = [
      batch("b3", 3, "跑测试"),
      batch("b7", 7, "跑测试"),
      batch("b1", 1, "先看代码"),
    ];
    const matched = matchTurnBatches(
      [
        { id: "a1", text: "先看代码" },
        { id: "a2", text: "跑测试" },
        { id: "a3", text: "跑测试" },
      ],
      batches,
    );
    expect(matched.get("a1")?.id).toBe("b1");
    expect(matched.get("a2")?.id).toBe("b3");
    expect(matched.get("a3")?.id).toBe("b7");
  });

  it("同文消息多于同文批次:超出的消息不配(不猜测)", () => {
    const matched = matchTurnBatches(
      [
        { id: "a1", text: "继续" },
        { id: "a2", text: "继续" },
      ],
      [batch("b2", 2, "继续")],
    );
    expect(matched.get("a1")?.id).toBe("b2");
    expect(matched.has("a2")).toBe(false);
  });

  it("无匹配(文本不等/清单为空)不配", () => {
    expect(matchTurnBatches([{ id: "a1", text: "甲" }], [batch("b1", 1, "乙")]).size).toBe(0);
    expect(matchTurnBatches([{ id: "a1", text: "甲" }], []).size).toBe(0);
  });

  it("空 prompt 批次(guard/edit 轮或旧账本)不参与配对", () => {
    const matched = matchTurnBatches([{ id: "a1", text: "修复" }], [batch("b1", 1, "")]);
    expect(matched.size).toBe(0);
  });

  it("清单乱序输入不影响配对序;git 归因批次原样透传", () => {
    const matched = matchTurnBatches(
      [
        { id: "a1", text: "改样式" },
        { id: "a2", text: "改样式" },
      ],
      [batch("b9", 9, "改样式", "git"), batch("b4", 4, "改样式", "git")],
    );
    expect(matched.get("a1")?.id).toBe("b4");
    expect(matched.get("a2")?.id).toBe("b9");
    expect(matched.get("a2")?.attribution).toBe("git");
  });
});
