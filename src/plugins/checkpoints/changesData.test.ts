/**
 * changesData 契约测试(0.4.0 项11 变更总览纯逻辑):
 * - synthesizeChange:五态合成优先级矩阵写死(reverted > D > changed > committed
 *   > same,对齐 view.rs reverted 短路序;no_baseline 只附加不改主态);判定取
 *   最近批条目(D 后再改 = 非删除)
 * - foldFileChanges:跨批折叠 ± 账本累加/批次数/最近批选取(ts 平局 index 胜)
 * - canRevertChange:与批审阅单 FileSections 同判据(pending && same && 有前像)
 * - filterGroups / sortGroups / capRows:过滤、双序、cap 截断(过滤/展开放行全量)
 */
import { describe, expect, it } from "vitest";
import type { CkptBatch, CkptBatchFile } from "@kernel/ipc";

import {
  CHANGES_CAP,
  canRevertChange,
  capRows,
  filterGroups,
  foldFileChanges,
  sortGroups,
  summarizeChanges,
  synthesizeChange,
} from "./changesData";

let seq = 0;

function file(overrides: Partial<CkptBatchFile>): CkptBatchFile {
  return {
    path: "a.ts",
    status: "M",
    reverted: false,
    live: "same",
    stale: false,
    editCount: 0,
    additions: 0,
    deletions: 0,
    noBaseline: false,
    ...overrides,
  };
}

function batch(overrides: Partial<CkptBatch>): CkptBatch {
  return {
    id: `b${++seq}`,
    index: seq,
    open: false,
    ts: seq * 1000,
    tsEnd: null,
    sessionId: "cli-1",
    prompt: "改点东西",
    engine: "",
    model: "",
    thinking: "",
    state: "pending",
    doneReason: null,
    guardId: null,
    files: [],
    attribution: "events",
    marksRefs: [],
    ...overrides,
  } as CkptBatch;
}

describe("synthesizeChange 优先级矩阵(写死,防口径漂移)", () => {
  it("五态各一:status D→已删除 / reverted→已回退 / changed→内容已变 / committed→已提交 / same→改动中", () => {
    expect(synthesizeChange(file({ status: "D" }))).toBe("deleted");
    expect(synthesizeChange(file({ reverted: true }))).toBe("reverted");
    expect(synthesizeChange(file({ live: "changed", stale: true }))).toBe("changed");
    expect(synthesizeChange(file({ live: "committed" }))).toBe("committed");
    expect(synthesizeChange(file({ live: "same" }))).toBe("running");
  });

  it("优先级①压②:status D 且 reverted 同时命中 → 已回退(删后回退删除不误标已删除)", () => {
    expect(synthesizeChange(file({ status: "D", reverted: true }))).toBe("reverted");
  });

  it("live=reverted(整批已退的便捷编码)同样判已回退", () => {
    expect(synthesizeChange(file({ live: "reverted" }))).toBe("reverted");
  });

  it("no_baseline 附加 chip 不改主态:工作区外首轮 same 仍是改动中", () => {
    expect(synthesizeChange(file({ live: "same", noBaseline: true }))).toBe("running");
  });
});

describe("foldFileChanges 折叠聚合", () => {
  it("最近批选取:D 后再改 = 最近批条目非 D,判内容已变而非已删除", () => {
    const groups = foldFileChanges([
      batch({ id: "b1", files: [file({ path: "a.ts", status: "D", additions: 0, deletions: 9 })] }),
      batch({ id: "b2", files: [file({ path: "a.ts", status: "M", live: "changed", additions: 4, deletions: 1 })] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].latestBatch.id).toBe("b2");
    expect(synthesizeChange(groups[0].latestFile)).toBe("changed");
  });

  it("D 且其后无再改、最近批回退了删除 → 已回退(reverted 短路序,P1 锁定)", () => {
    const groups = foldFileChanges([
      batch({ id: "b1", files: [file({ path: "a.ts", status: "D", additions: 0, deletions: 9 })] }),
      batch({ id: "b2", files: [file({ path: "a.ts", status: "D", reverted: true, live: "reverted" })] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].latestBatch.id).toBe("b2");
    expect(synthesizeChange(groups[0].latestFile)).toBe("reverted");
  });

  it("± 账本累加(回退不回缩)+ 批次数累计;状态/±/批次数同组互不干扰", () => {
    const groups = foldFileChanges([
      batch({ ts: 3000, files: [file({ path: "a.ts", additions: 5, deletions: 2 })] }),
      batch({ ts: 2000, files: [file({ path: "a.ts", reverted: true, additions: 3, deletions: 1 })] }),
      batch({ ts: 1000, files: [file({ path: "a.ts", additions: 0, deletions: 7 })] }),
      batch({ ts: 1500, files: [file({ path: "other.ts", additions: 1 })] }),
    ]);
    const a = groups.find((g) => g.path === "a.ts");
    expect(a).toBeDefined();
    expect(a!.batchCount).toBe(3);
    expect(a!.additions).toBe(8);
    expect(a!.deletions).toBe(10);
    expect(a!.latestBatch.ts).toBe(3000);
    expect(groups).toHaveLength(2);
  });

  it("ts 平局取 index 大者为最近批(同轮双锚确定性)", () => {
    const groups = foldFileChanges([
      batch({ id: "late", index: 9, ts: 1000, files: [file({ path: "a.ts" })] }),
      batch({ id: "early", index: 2, ts: 1000, files: [file({ path: "a.ts" })] }),
    ]);
    expect(groups[0].latestBatch.id).toBe("late");
  });

  it("空清单/空文件集 → 空组", () => {
    expect(foldFileChanges([])).toHaveLength(0);
    expect(foldFileChanges([batch({}), batch({ files: [] })])).toHaveLength(0);
  });
});

describe("canRevertChange(与 FileSections 同判据)", () => {
  const groupWith = (b: Partial<CkptBatch>, f: Partial<CkptBatchFile>) =>
    foldFileChanges([batch({ ...b, files: [file(f)] })])[0];

  it("pending + same + 有前像 → 可回退", () => {
    expect(canRevertChange(groupWith({}, {}))).toBe(true);
  });
  it("批已通过 / 内容已变 / 无前像 → 不可回退", () => {
    expect(canRevertChange(groupWith({ state: "approved" }, {}))).toBe(false);
    expect(canRevertChange(groupWith({}, { live: "changed" }))).toBe(false);
    expect(canRevertChange(groupWith({}, { noBaseline: true }))).toBe(false);
  });
});

describe("filterGroups / sortGroups / capRows", () => {
  const groups = foldFileChanges([
    batch({ id: "b3", ts: 3000, files: [file({ path: "src/Preview.rs", live: "changed", additions: 7, deletions: 2 })] }),
    batch({ id: "b2", ts: 2000, files: [file({ path: "src/app.ts", additions: 1 })] }),
    batch({ id: "b1", ts: 1000, files: [file({ path: "docs/md", status: "D", additions: 0, deletions: 40 })] }),
  ]);

  it("状态过滤 + 路径子串(大小写不敏感)双闸;all + 空串原样通过", () => {
    expect(filterGroups(groups, "all", "")).toHaveLength(3);
    expect(filterGroups(groups, "changed", "").map((g) => g.path)).toEqual(["src/Preview.rs"]);
    expect(filterGroups(groups, "all", "PREVIEW").map((g) => g.path)).toEqual(["src/Preview.rs"]);
    expect(filterGroups(groups, "running", "src/")).toHaveLength(1);
    expect(filterGroups(groups, "deleted", "src/")).toHaveLength(0);
  });

  it("排序:batch = 最近批 ts 降序;pm = 账本 ± 合计降序(平局回落 ts)", () => {
    expect(sortGroups(groups, "batch").map((g) => g.latestBatch.id)).toEqual(["b3", "b2", "b1"]);
    expect(sortGroups(groups, "pm").map((g) => g.path)).toEqual(["docs/md", "src/Preview.rs", "src/app.ts"]);
    expect(
      sortGroups(groups, "pm").filter((g) => g.path === "docs/md").length,
    ).toBe(1);
  });

  it("cap 截断:无过滤浏览态截 50;过滤/展开放行全量", () => {
    const many = Array.from({ length: CHANGES_CAP + 7 }, (_, i) => ({
      path: `f${i}.ts`,
      latestBatch: batch({ files: [] }),
      latestFile: file({ path: `f${i}.ts` }),
      batchCount: 1,
      additions: 0,
      deletions: 0,
    }));
    expect(capRows(many, { filtering: false, expanded: false })).toHaveLength(CHANGES_CAP);
    expect(capRows(many, { filtering: true, expanded: false })).toHaveLength(many.length);
    expect(capRows(many, { filtering: false, expanded: true })).toHaveLength(many.length);
  });
});

describe("summarizeChanges 摘要条(全会话口径)", () => {
  it("文件数 / 可回退 / 高危 / 账本 ± 合计", () => {
    const groups = foldFileChanges([
      batch({ files: [file({ path: ".ssh/config", additions: 5, deletions: 2 })] }),
      batch({ state: "approved", files: [file({ path: "a.ts", additions: 3, deletions: 1 })] }),
      batch({ files: [file({ path: ".env", live: "changed", additions: 0, deletions: 9 })] }),
    ]);
    const s = summarizeChanges(groups);
    expect(s.files).toBe(3);
    expect(s.revertible).toBe(1);
    expect(s.highRisk).toBe(2);
    expect(s.additions).toBe(8);
    expect(s.deletions).toBe(12);
  });
});
