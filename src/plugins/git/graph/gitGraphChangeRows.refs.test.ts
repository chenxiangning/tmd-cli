/**
 * gitGraphChangeRows.refs 契约(自 gitGraphChangeRows.test.ts 因 300 行铁则拆出):
 * - gitGraphRefs:normalizeRef 装饰名归一(HEAD -> / tag: / refs/* 前缀)、
 *   findCommitShaForRef ref→提交定位(双向归一、首匹配、未命中空串)、
 *   uniqueParents 清洗(去重/trim/丢空/保序)、inferCommonAncestorSha merge-base 推断、
 *   cloneLane 泳道克隆
 * - views/graphGeometry:泳道几何常数的布局不变量(圆点居中、行高、容纳性)、
 *   合成行哨兵 id 互异且前缀避开真实 sha
 */

import { describe, expect, it } from "vitest";
import {
  cloneLane,
  findCommitShaForRef,
  inferCommonAncestorSha,
  normalizeRef,
  uniqueParents,
  GRAPH_REF_COLORS,
  GIT_GRAPH_INCOMING_CHANGES_ID,
  GIT_GRAPH_OUTGOING_CHANGES_ID,
} from "./gitGraphRefs";
import {
  GRAPH_CURVE_R,
  GRAPH_DOT_R,
  GRAPH_DOT_Y,
  GRAPH_LINE_W,
  GRAPH_STROKE_W,
  GRAPH_SWIMLANE_WIDTH,
  GRAPH_SVG_HEIGHT,
} from "../views/graphGeometry";

const LOCAL = GRAPH_REF_COLORS.local;

describe("gitGraphRefs ref 解析与祖先推断", () => {
  it("normalizeRef 归一各类前缀,空串回空", () => {
    const cases: Array<[string, string]> = [
      ["HEAD -> main", "main"],
      ["tag: v1.0", "v1.0"],
      ["refs/heads/main", "main"],
      ["refs/remotes/origin/main", "origin/main"],
      ["refs/tags/v1", "v1"],
      ["HEAD -> refs/heads/feature", "feature"],
      ["  origin/main  ", "origin/main"],
      ["main", "main"],
      ["", ""],
      ["   ", ""],
    ];
    for (const [raw, want] of cases) expect(normalizeRef(raw)).toBe(want);
  });

  it("findCommitShaForRef 双向归一匹配,首匹配优先,未命中回空串", () => {
    const commits = [
      { sha: "a", parents: [], refs: ["HEAD -> main"] },
      { sha: "b", parents: [], refs: ["refs/remotes/origin/main"] },
      { sha: "c", parents: [] },
    ];
    expect(findCommitShaForRef(commits, "main")).toBe("a");
    expect(findCommitShaForRef(commits, "refs/heads/main")).toBe("a");
    expect(findCommitShaForRef(commits, "origin/main")).toBe("b");
    expect(findCommitShaForRef(commits, "HEAD -> origin/main")).toBe("b");
    expect(findCommitShaForRef(commits, "nope")).toBe("");
    expect(findCommitShaForRef(commits, "")).toBe("");
  });

  it("uniqueParents 去重、trim、丢空、保首现顺序", () => {
    expect(uniqueParents([" p1 ", "p1", "", "   ", "p2", "p1"])).toEqual(["p1", "p2"]);
  });

  it("inferCommonAncestorSha 取首个双方可达提交,不相连回空串", () => {
    const fork = [
      { sha: "t", parents: ["base"] },
      { sha: "b", parents: ["base"] },
      { sha: "base", parents: [] },
    ];
    expect(inferCommonAncestorSha(fork, "t", "b")).toBe("base");
    expect(inferCommonAncestorSha(fork, "t", "base")).toBe("base");
    const merged = [
      { sha: "m", parents: ["a", "b"] },
      { sha: "a", parents: ["root"] },
      { sha: "b", parents: ["root"] },
      { sha: "root", parents: [] },
    ];
    expect(inferCommonAncestorSha(merged, "m", "b")).toBe("b");
    expect(inferCommonAncestorSha(merged, "a", "b")).toBe("root");
    expect(
      inferCommonAncestorSha([{ sha: "x", parents: [] }, { sha: "y", parents: [] }], "x", "y"),
    ).toBe("");
    expect(inferCommonAncestorSha([], "x", "y")).toBe("");
  });

  it("cloneLane 返回等值新对象,与原 lane 解耦", () => {
    const origin = { id: "a", color: LOCAL };
    const copy = cloneLane(origin);
    expect(copy).toEqual(origin);
    expect(copy).not.toBe(origin);
    copy.id = "b";
    expect(origin.id).toBe("a");
  });
});

describe("graphGeometry 泳道几何常数", () => {
  it("圆点纵向居中于行:DOT_Y=泳道宽,行高=泳道宽两倍", () => {
    expect(GRAPH_DOT_Y).toBe(GRAPH_SWIMLANE_WIDTH);
    expect(GRAPH_SVG_HEIGHT).toBe(GRAPH_SWIMLANE_WIDTH * 2);
  });

  it("布局常量与容纳性不变量:弯道半径、线宽、圆点半径", () => {
    expect([GRAPH_SWIMLANE_WIDTH, GRAPH_SVG_HEIGHT, GRAPH_DOT_R]).toEqual([11, 22, 4]);
    expect(GRAPH_CURVE_R).toBeLessThan(GRAPH_SWIMLANE_WIDTH);
    expect(GRAPH_STROKE_W).toBeGreaterThan(GRAPH_LINE_W);
  });

  it("合成行哨兵 id 非空且互异,前缀避开真实 sha", () => {
    expect(GIT_GRAPH_INCOMING_CHANGES_ID).not.toBe(GIT_GRAPH_OUTGOING_CHANGES_ID);
    expect(GIT_GRAPH_INCOMING_CHANGES_ID).toMatch(/^scm-graph-/);
    expect(GIT_GRAPH_OUTGOING_CHANGES_ID).toMatch(/^scm-graph-/);
  });
});
