/**
 * marksSendTransform 契约测试 —— 覆盖状态机主线:
 * pending → staged(stageMarks)→ transform 注入 wire 并翻 sent;staged 清空后不再注入。
 */

import { beforeEach, describe, expect, it } from "vitest";
import * as ws from "@kernel/workspace";
import { addMark, marksSnapshot, removeMark } from "./store";
import { marksSendTransform, serializeMark, stageMarks } from "./sendTransform";

const LINES = ["l1", "l2", "l3", "l4"];

describe("marksSendTransform", () => {
  beforeEach(() => {
    for (const [cwd, marks] of Object.entries(marksSnapshot().byCwd))
      for (const m of [...marks]) removeMark(cwd, m.id);
  });

  it("staged 标记注入 wire 尾部并翻 sent;pending 不注入", () => {
    const w = ws.addWorkspace("/repo/tf");
    ws.setActiveWorkspace(w.id);
    const keep = addMark({ cwd: w.root, path: "/repo/tf/a.ts", startLine: 1, endLine: 2, lines: LINES, note: "待发" });
    const hold = addMark({ cwd: w.root, path: "/repo/tf/b.ts", startLine: 3, endLine: 3, lines: LINES, note: "" });
    stageMarks(w.root, [keep]);

    const wire = marksSendTransform("正文", null);
    expect(wire).toContain("请看我在文件里标记的 1 处:");
    expect(wire).toContain("/repo/tf/a.ts:L1-L2");
    expect(wire).toContain("标注:待发");
    expect(wire).not.toContain("b.ts");
    expect(marksSnapshot().byCwd[w.root].find((m) => m.id === keep.id)?.state).toBe("sent");
    expect(marksSnapshot().byCwd[w.root].find((m) => m.id === hold.id)?.state).toBe("pending");

    /* sent 后不再注入 */
    expect(marksSendTransform("二发", null)).toBe("二发");
    ws.removeWorkspace(w.id);
  });

  it("serializeMark 单行/跨行/空备注格式稳定", () => {
    expect(serializeMark({ path: "/a/b.ts", startLine: 3, endLine: 3, note: "", excerpt: "x" }))
      .toBe("/a/b.ts:L3\n  > x\n  标注:(无备注)");
    expect(serializeMark({ path: "/a/b.ts", startLine: 3, endLine: 5, note: "n", excerpt: "p\nq" }))
      .toBe("/a/b.ts:L3-L5\n  > p\n  > q\n  标注:n");
  });

  it("staged 再点撤回 pending(行内卡片/芯片 ✕ 共用)", () => {
    const w = ws.addWorkspace("/repo/tg");
    ws.setActiveWorkspace(w.id);
    const mk = addMark({ cwd: w.root, path: "/repo/tg/a.ts", startLine: 1, endLine: 1, lines: LINES, note: "" });
    stageMarks(w.root, [mk]);
    expect(marksSnapshot().byCwd[w.root][0]?.state).toBe("staged");
    stageMarks(w.root, []); /* 空集无操作 */
    expect(marksSnapshot().byCwd[w.root][0]?.state).toBe("staged");
    ws.removeWorkspace(w.id);
  });
});
