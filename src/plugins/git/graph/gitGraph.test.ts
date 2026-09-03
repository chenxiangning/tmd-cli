/**
 * computeGitGraph 契约:泳道分配、merge 分叉/汇合、ref 语义色、传出/传入合成行。
 * 用例取自 VS Code SCM Graph 的可观察行为(行序 = 输入序,新→旧)。
 */

import { describe, expect, it } from "vitest";
import {
  computeGitGraph,
  GIT_GRAPH_INCOMING_CHANGES_ID,
  GIT_GRAPH_OUTGOING_CHANGES_ID,
  GRAPH_REF_COLORS,
  type GraphRow,
} from "./gitGraph";

/** GraphRow → 断言用的精简形(剥掉 kind)。 */
function simplify(row: GraphRow) {
  const { kind: _kind, ...rest } = row;
  return rest;
}

describe("computeGitGraph", () => {
  it("线性历史单泳道贯通", () => {
    const result = computeGitGraph([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(result.maxCols).toBe(1);
    expect(result.rows.map(simplify)).toEqual([
      {
        sha: "c",
        parents: ["b"],
        commitCol: 0,
        commitColor: 0,
        inputLanes: [],
        outputLanes: [{ id: "b", color: 0 }],
        isHead: true,
        isMerge: false,
      },
      {
        sha: "b",
        parents: ["a"],
        commitCol: 0,
        commitColor: 0,
        inputLanes: [{ id: "b", color: 0 }],
        outputLanes: [{ id: "a", color: 0 }],
        isHead: false,
        isMerge: false,
      },
      {
        sha: "a",
        parents: [],
        commitCol: 0,
        commitColor: 0,
        inputLanes: [{ id: "a", color: 0 }],
        outputLanes: [],
        isHead: false,
        isMerge: false,
      },
    ]);
  });

  it("merge 提交分叉双泳道,到共同根汇合", () => {
    const result = computeGitGraph([
      { sha: "m", parents: ["a", "b"] },
      { sha: "a", parents: ["r"] },
      { sha: "b", parents: ["r"] },
      { sha: "r", parents: [] },
    ]);
    expect(result.maxCols).toBe(2);
    const rows = result.rows.map(simplify);
    // m:第二父 b 新开泳道(颜色 1)
    expect(rows[0].outputLanes).toEqual([
      { id: "a", color: 0 },
      { id: "b", color: 1 },
    ]);
    // b 在第 1 列,输出与 a 的输出在 r 汇合(两条 lane 同 id 不同色)
    expect(rows[2].commitCol).toBe(1);
    expect(rows[3].inputLanes).toEqual([
      { id: "r", color: 0 },
      { id: "r", color: 1 },
    ]);
  });

  it("ref 语义色:本地分支 local,远端名命中 remote", () => {
    const result = computeGitGraph(
      [
        { sha: "tip", parents: ["merge", "side"] },
        { sha: "merge", parents: ["base"], refs: ["main"] },
        { sha: "side", parents: ["base"], refs: ["origin/side"] },
        { sha: "base", parents: [] },
      ],
      { currentRef: "main", remoteRef: "origin/side", remoteName: "origin" },
    );
    const rows = result.rows.map(simplify);
    // side 携带 origin/side → 整条泳道 remote 色;base 被 main 命中 → local 色
    expect(rows[2].commitColor).toBe(GRAPH_REF_COLORS.remote);
    expect(rows[3].commitColor).toBe(GRAPH_REF_COLORS.local);
    // currentRef 命中的 merge 行是 head
    expect(rows[1].isHead).toBe(true);
  });

  it("ahead/behind 插入传出/传入合成行", () => {
    const result = computeGitGraph(
      [
        { sha: "a", parents: ["b"], refs: ["origin/main"] },
        { sha: "b", parents: ["e"] },
        { sha: "c", parents: ["d"], refs: ["main"] },
        { sha: "d", parents: ["e"] },
        { sha: "e", parents: ["f"] },
        { sha: "f", parents: ["g"] },
      ],
      {
        currentRef: "main",
        remoteRef: "origin/main",
        showRemoteChangeMarkers: true,
        ahead: 2,
        behind: 2,
      },
    );
    expect(result.maxCols).toBe(2);
    expect(result.rows.map((row) => row.kind)).toEqual([
      "commit",
      "commit",
      "outgoing-changes",
      "commit",
      "commit",
      "incoming-changes",
      "commit",
      "commit",
    ]);

    const outgoing = result.rows[2];
    expect(outgoing.sha).toBe(GIT_GRAPH_OUTGOING_CHANGES_ID);
    expect(outgoing.parents).toEqual(["c"]);
    expect(outgoing.commitCol).toBe(1);
    expect(outgoing.outputLanes).toEqual([
      { id: "e", color: GRAPH_REF_COLORS.remote },
      { id: "c", color: GRAPH_REF_COLORS.local },
    ]);

    const incoming = result.rows[5];
    expect(incoming.sha).toBe(GIT_GRAPH_INCOMING_CHANGES_ID);
    expect(incoming.parents).toEqual(["e"]);
    expect(incoming.commitCol).toBe(0);
    expect(incoming.outputLanes).toEqual([
      { id: "e", color: GRAPH_REF_COLORS.remote },
      { id: "e", color: GRAPH_REF_COLORS.local },
    ]);
  });
});
