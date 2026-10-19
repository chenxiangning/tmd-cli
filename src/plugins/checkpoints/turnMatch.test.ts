/**
 * matchTurnBatches 契约测试:轮号+文本双闸配对、空批轮占号归位、文本不等
 * 不配、轮号错位不配、空 prompt 批次不参与、乱序清单按 index 归位、git 归因透传。
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
  it("轮号对齐:batch.index 命中消息位置 +1 且文本全等", () => {
    const batches = [
      batch("b3", 3, "跑测试"),
      batch("b2", 2, "跑测试"),
      batch("b1", 1, "先看代码"),
      batch("b9", 9, "跑测试" /* 轮号 9 > 位置 3:不配,不猜测 */),
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
    expect(matched.get("a2")?.id).toBe("b2");
    expect(matched.get("a3")?.id).toBe("b3");
    expect(matched.size).toBe(3);
  });

  it("同文两轮首轮空批(纯阅读轮占号):chip 归位真实轮,不挤位", () => {
    const matched = matchTurnBatches(
      [
        { id: "a1", text: "继续" },
        { id: "a2", text: "继续" },
      ],
      [batch("b2", 2, "继续")],
    );
    expect(matched.get("a2")?.id).toBe("b2");
    expect(matched.has("a1")).toBe(false);
  });

  it("文本不等/清单为空不配;文本相等但轮号错位也不配(不猜测)", () => {
    expect(matchTurnBatches([{ id: "a1", text: "甲" }], [batch("b1", 1, "乙")]).size).toBe(0);
    expect(matchTurnBatches([{ id: "a1", text: "甲" }], []).size).toBe(0);
    expect(matchTurnBatches([{ id: "a1", text: "甲" }], [batch("b2", 2, "甲")]).size).toBe(0);
  });

  it("空 prompt 批次(guard/edit 轮或旧账本)不参与配对", () => {
    const matched = matchTurnBatches([{ id: "a1", text: "修复" }], [batch("b1", 1, "")]);
    expect(matched.size).toBe(0);
  });

  it("清单乱序输入不影响配对;git 归因批次原样透传", () => {
    const matched = matchTurnBatches(
      [
        { id: "a1", text: "改样式" },
        { id: "a2", text: "改样式" },
      ],
      [batch("b2", 2, "改样式", "git"), batch("b1", 1, "改样式", "git")],
    );
    expect(matched.get("a1")?.id).toBe("b1");
    expect(matched.get("a2")?.id).toBe("b2");
    expect(matched.get("a2")?.attribution).toBe("git");
  });
});
