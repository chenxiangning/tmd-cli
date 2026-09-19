/**
 * gitGraphChangeRows 契约(主文件;同族小模块 gitGraphRefs / views/graphGeometry 的用例因 300 行
 * 铁则拆至 gitGraphChangeRows.refs.test.ts,契约清单见其头注释):
 * - addIncomingOutgoingChangeRows:传入/传出合成行的落位(传入在 merge-base 行前、传出在 tip 行前)
 * - 传入行穿越 lane 改名判别:仅「id=merge-base 且 remote 色」改哨兵,同 id 其他色保持原名
 * - 边界:单提交(merge-base 行不可见仍插传出行)、分叉双向同插、合并行已消费 merge-base 时整体抑制
 * - 计数契约:ahead/behind 仅显式 0 抑制,undefined 视为需展示;options.mergeBase 优先、空白串回退推断
 */

import { describe, expect, it } from "vitest";
import { addIncomingOutgoingChangeRows } from "./gitGraphChangeRows";
import {
  GRAPH_REF_COLORS,
  GIT_GRAPH_INCOMING_CHANGES_ID,
  GIT_GRAPH_OUTGOING_CHANGES_ID,
  type GitGraphCommit,
  type GitGraphOptions,
  type GraphColor,
  type GraphLane,
} from "./gitGraphRefs";
import type { GraphRow } from "./gitGraph";

const LOCAL = GRAPH_REF_COLORS.local;
const REMOTE = GRAPH_REF_COLORS.remote;

function lane(id: string, color: GraphColor): GraphLane {
  return { id, color };
}

function row(sha: string, init: Partial<GraphRow> = {}): GraphRow {
  return {
    kind: "commit",
    sha,
    parents: [],
    commitCol: 0,
    commitColor: LOCAL,
    inputLanes: [],
    outputLanes: [],
    isHead: false,
    isMerge: false,
    ...init,
  };
}

function commit(sha: string, refs?: string[], parents: string[] = []): GitGraphCommit {
  return refs ? { sha, refs, parents } : { sha, parents };
}

/** 分叉夹具:本地 t 与远端 rb 各自落在 base 上(ahead/behind 各 1 的最小形态)。 */
function divergedRows(): GraphRow[] {
  return [
    row("t", { parents: ["base"], outputLanes: [lane("base", LOCAL)] }),
    row("rb", {
      parents: ["base"],
      commitColor: REMOTE,
      inputLanes: [lane("base", REMOTE)],
      outputLanes: [lane("base", REMOTE)],
    }),
    row("base", { commitColor: REMOTE, inputLanes: [lane("base", REMOTE)] }),
  ];
}

function divergedCommits(): GitGraphCommit[] {
  return [
    commit("t", ["HEAD -> main"], ["base"]),
    commit("rb", ["origin/main"], ["base"]),
    commit("base"),
  ];
}

describe("addIncomingOutgoingChangeRows 传入/传出合成行装配", () => {
  it("传入行插在 merge-base 行之前,仅 remote 色穿越 lane 改名哨兵", () => {
    const rows = [
      row("t", { parents: ["r0"], outputLanes: [lane("r0", LOCAL)] }),
      row("b", {
        parents: ["r0"],
        commitColor: REMOTE,
        inputLanes: [lane("r0", LOCAL), lane("r0", REMOTE)],
        outputLanes: [lane("r0", REMOTE)],
      }),
      row("r0", { commitColor: REMOTE, inputLanes: [lane("r0", REMOTE)] }),
    ];
    const commits = [
      commit("t", ["HEAD -> main"], ["r0"]),
      commit("b", ["origin/main"], ["r0"]),
      commit("r0"),
    ];
    addIncomingOutgoingChangeRows(rows, commits, {
      currentRef: "main",
      remoteRef: "origin/main",
      ahead: 0,
      behind: 1,
    });

    expect(rows.map((r) => r.sha)).toEqual(["t", "b", GIT_GRAPH_INCOMING_CHANGES_ID, "r0"]);
    const incoming = rows[2];
    expect(incoming.kind).toBe("incoming-changes");
    expect(incoming.parents).toEqual(["r0"]);
    // 几何:入边承接改名后的哨兵 lane,出边保持指向 merge-base 提交(remote 色)
    expect(incoming.inputLanes).toEqual([{ id: GIT_GRAPH_INCOMING_CHANGES_ID, color: REMOTE }]);
    expect(incoming.outputLanes).toEqual([{ id: "r0", color: REMOTE }]);
    expect(incoming.commitCol).toBe(0);
    expect(incoming.commitColor).toBe(REMOTE);
    // 改名判别:同 id 但 local 色的 lane 原样,仅 remote 色命中哨兵
    expect(rows[1].inputLanes).toEqual([
      lane("r0", LOCAL),
      { id: GIT_GRAPH_INCOMING_CHANGES_ID, color: REMOTE },
    ]);
    expect(rows[1].outputLanes).toEqual([{ id: GIT_GRAPH_INCOMING_CHANGES_ID, color: REMOTE }]);
    // 其余行不被误改
    expect(rows[0].outputLanes).toEqual([lane("r0", LOCAL)]);
    expect(rows[3].inputLanes).toEqual([lane("r0", REMOTE)]);
  });

  it("传出行插在 tip 行之前新开 local 泳道列,merge-base 行不在可见集也照插", () => {
    const rows = [row("t", { parents: ["r0"], inputLanes: [lane("m", LOCAL)] })];
    const commits = [commit("t", ["HEAD -> main"], ["r0"]), commit("r0", ["origin/main"])];
    addIncomingOutgoingChangeRows(rows, commits, {
      currentRef: "main",
      remoteRef: "origin/main",
      ahead: 1,
    });

    expect(rows.map((r) => r.sha)).toEqual([GIT_GRAPH_OUTGOING_CHANGES_ID, "t"]);
    const outgoing = rows[0];
    expect(outgoing.kind).toBe("outgoing-changes");
    expect(outgoing.parents).toEqual(["t"]);
    // 几何:输入无哨兵 lane → 圆点落在输入泳道之后的追加列;出边为输入克隆 + 指回 tip 的 local 色新泳道
    expect(outgoing.commitCol).toBe(1);
    expect(outgoing.commitColor).toBe(LOCAL);
    expect(outgoing.inputLanes).toEqual([lane("m", LOCAL)]);
    expect(outgoing.outputLanes).toEqual([lane("m", LOCAL), { id: "t", color: LOCAL }]);
    // tip 行入边追加指回自身的 local 色泳道
    expect(rows[1].inputLanes).toEqual([lane("m", LOCAL), { id: "t", color: LOCAL }]);
  });

  it("合并行已消费 merge-base 泳道时不插传入行也不改名", () => {
    const rows = [
      row("t", { parents: ["m"], outputLanes: [lane("m", LOCAL)] }),
      row("m", {
        parents: ["b0", "r0"],
        inputLanes: [lane("m", LOCAL)],
        outputLanes: [lane("b0", REMOTE)],
        isMerge: true,
      }),
      row("b0", {
        commitColor: REMOTE,
        inputLanes: [lane("b0", REMOTE)],
        outputLanes: [lane("r0", REMOTE)],
      }),
      row("r0", { commitColor: REMOTE, inputLanes: [lane("r0", REMOTE)] }),
    ];
    // 远端 tip rb 不在可见行内:merge-base 推断为已被合并的 b0
    const commits = [
      commit("t", ["HEAD -> main"], ["m"]),
      commit("rb", ["origin/main"], ["b0"]),
      commit("m", undefined, ["b0", "r0"]),
      commit("b0", undefined, ["r0"]),
      commit("r0"),
    ];
    addIncomingOutgoingChangeRows(rows, commits, {
      currentRef: "main",
      remoteRef: "origin/main",
      ahead: 0,
      behind: 1,
    });

    expect(rows.map((r) => r.sha)).toEqual(["t", "m", "b0", "r0"]);
    // m 双亲含 merge-base → 视为已消费:b0 泳道保持原名,不重复标记
    expect(rows[1].outputLanes).toEqual([lane("b0", REMOTE)]);
    expect(rows.every((r) => r.kind === "commit")).toBe(true);
  });

  it("分叉时双向同插:序为 传出/tip/远端/传入/base,远端行 lane 改名", () => {
    const rows = divergedRows();
    addIncomingOutgoingChangeRows(rows, divergedCommits(), {
      currentRef: "main",
      remoteRef: "origin/main",
      ahead: 1,
      behind: 1,
    });

    expect(rows.map((r) => r.sha)).toEqual([
      GIT_GRAPH_OUTGOING_CHANGES_ID,
      "t",
      "rb",
      GIT_GRAPH_INCOMING_CHANGES_ID,
      "base",
    ]);
    expect(rows[2].inputLanes).toEqual([{ id: GIT_GRAPH_INCOMING_CHANGES_ID, color: REMOTE }]);
    expect(rows[3].outputLanes).toEqual([{ id: "base", color: REMOTE }]);
    // 传出行落位:tip 行入边获得指回自身的 local 色泳道
    expect(rows[0].outputLanes).toEqual([{ id: "t", color: LOCAL }]);
    expect(rows[1].inputLanes).toEqual([{ id: "t", color: LOCAL }]);
  });

  it("ahead/behind 仅显式 0 抑制,undefined 视为需展示", () => {
    const shared = { currentRef: "main", remoteRef: "origin/main" } as const;
    const run = (options: GitGraphOptions) => {
      const rows = divergedRows();
      addIncomingOutgoingChangeRows(rows, divergedCommits(), options);
      return rows.map((r) => r.sha);
    };
    const ids = [GIT_GRAPH_OUTGOING_CHANGES_ID, GIT_GRAPH_INCOMING_CHANGES_ID];

    expect(run({ ...shared, ahead: 0, behind: 0 })).toEqual(["t", "rb", "base"]);
    expect(run({ ...shared })).toEqual([ids[0], "t", "rb", ids[1], "base"]);
    expect(run({ ...shared, ahead: 1, behind: 0 })).toEqual([ids[0], "t", "rb", "base"]);
    expect(run({ ...shared, ahead: 0, behind: 1 })).toEqual(["t", "rb", ids[1], "base"]);
  });

  it("options.mergeBase 优先于推断,空白串视同缺省", () => {
    const run = (mergeBase?: string) => {
      const rows = divergedRows();
      addIncomingOutgoingChangeRows(rows, divergedCommits(), {
        currentRef: "main",
        remoteRef: "origin/main",
        behind: 1,
        ahead: 0,
        mergeBase,
      });
      return rows.map((r) => r.sha);
    };
    expect(run("base")).toEqual(["t", "rb", GIT_GRAPH_INCOMING_CHANGES_ID, "base"]);
    expect(run("   ")).toEqual(["t", "rb", GIT_GRAPH_INCOMING_CHANGES_ID, "base"]);
  });

  it("ref 未命中、已同步、推断不出祖先时整体无操作", () => {
    for (const options of [
      { currentRef: "nope", remoteRef: "origin/main", ahead: 1, behind: 1 },
      { currentRef: "main", remoteRef: "nope", ahead: 1, behind: 1 },
    ] as GitGraphOptions[]) {
      const rows = divergedRows();
      const before = structuredClone(rows);
      addIncomingOutgoingChangeRows(rows, divergedCommits(), options);
      expect(rows).toEqual(before);
    }
    // 已同步:main 与 origin/main 指向同一提交
    const synced = [row("t"), row("old", { parents: ["t"] })];
    const syncedCommits = [
      commit("t", ["HEAD -> main", "origin/main"]),
      commit("old", undefined, ["t"]),
    ];
    addIncomingOutgoingChangeRows(synced, syncedCommits, {
      currentRef: "main",
      remoteRef: "origin/main",
      ahead: 3,
      behind: 3,
    });
    expect(synced.map((r) => r.sha)).toEqual(["t", "old"]);
    // 双方历史不相连:推断不出共同祖先
    const splitRows = [row("x"), row("y")];
    const splitCommits = [commit("x", ["main"]), commit("y", ["origin/main"])];
    addIncomingOutgoingChangeRows(splitRows, splitCommits, {
      currentRef: "main",
      remoteRef: "origin/main",
      ahead: 1,
      behind: 1,
    });
    expect(splitRows.every((r) => r.kind === "commit")).toBe(true);
  });
});

