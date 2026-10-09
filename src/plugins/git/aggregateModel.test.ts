/**
 * aggregateModel 单测:跨工作区去重(嵌套工作区重复扫描)、批量目标选择
 * (fetch 全 / pull 需上游 / push 需 ahead>0)、行级结果文案三 op 分支。
 */

import { describe, expect, it } from "vitest";
import type { GitRemoteOpReport, GitRepoSummary } from "@kernel/ipc";
import { dedupeGroups, selectTargets, formatRowResult, mapPool, type AggRepo } from "./aggregateModel";

function repo(path: string, over: Partial<GitRepoSummary> = {}): GitRepoSummary {
  return { path, name: path.split("/").pop() ?? path, branch: "main", kind: "repo", ...over };
}

function agg(path: string, over: Partial<AggRepo> = {}): AggRepo {
  return { ...repo(path), dirty: 0, ahead: 0, behind: 0, upstream: "origin/main", ...over };
}

describe("dedupeGroups", () => {
  it("跨工作区同 path 仓去重,首个工作区胜出", () => {
    const groups = dedupeGroups([
      { wsId: "ws1", wsName: "a", root: "/a", truncated: false, repos: [repo("/a"), repo("/a/sub")] },
      { wsId: "ws2", wsName: "sub", root: "/a/sub", truncated: false, repos: [repo("/a/sub"), repo("/b")] },
    ]);
    expect(groups.map((g) => g.repos.map((r) => r.path))).toEqual([["/a", "/a/sub"], ["/b"]]);
  });

  it("零仓工作区整组消失,状态字段给缺省", () => {
    const groups = dedupeGroups([
      { wsId: "ws1", wsName: "a", root: "/a", truncated: false, repos: [] },
      { wsId: "ws2", wsName: "b", root: "/b", truncated: false, repos: [repo("/b")] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].repos[0]).toMatchObject({ dirty: -1, ahead: 0, behind: 0, upstream: null });
  });
});

describe("selectTargets", () => {
  const repos = [
    agg("/clean", { upstream: "origin/main" }),
    agg("/no-upstream", { upstream: null }),
    agg("/ahead", { ahead: 2 }),
    agg("/ahead-no-upstream", { ahead: 3, upstream: null }),
  ];

  it("fetch = 全部仓(无上游也取,fetch 不依赖上游)", () => {
    const { targets, skipped } = selectTargets("fetch", repos);
    expect(targets).toHaveLength(4);
    expect(skipped.size).toBe(0);
  });

  it("pull = 有上游的仓,无上游标跳过", () => {
    const { targets, skipped } = selectTargets("pull", repos);
    expect(targets.map((r) => r.path)).toEqual(["/clean", "/ahead"]);
    expect(skipped.get("/no-upstream")).toBeTruthy();
    expect(skipped.get("/ahead-no-upstream")).toBeTruthy();
  });

  it("push = ahead>0 即可(无上游也推);无待推标因", () => {
    const { targets, skipped } = selectTargets("push", repos);
    expect(targets.map((r) => r.path)).toEqual(["/ahead", "/ahead-no-upstream"]);
    expect(skipped.get("/clean")).toBeTruthy();
    expect(skipped.get("/no-upstream")).toBeTruthy();
  });
});

describe("formatRowResult", () => {
  const base: GitRemoteOpReport = {
    upToDate: false, refs: 0, commits: 0, files: 0, insertions: 0, deletions: 0,
  };

  it("upToDate 三 op 统一「已是最新」", () => {
    for (const op of ["fetch", "pull", "push"] as const) {
      expect(formatRowResult(op, { ...base, upToDate: true })).toBe("已是最新");
    }
  });

  it("fetch 报引用数 / push 报提交数 / pull 报合入数", () => {
    expect(formatRowResult("fetch", { ...base, refs: 3 })).toContain("3");
    expect(formatRowResult("push", { ...base, commits: 2 })).toContain("2");
    expect(formatRowResult("pull", { ...base, commits: 4, files: 9 })).toContain("4");
  });

  it("pull 有文件变更但提交数为 0(squash 路径)回落「已是最新」", () => {
    expect(formatRowResult("pull", { ...base, commits: 0, files: 5 })).toBe("已是最新");
  });
});

describe("mapPool", () => {
  /** 纯微任务冲刷(无真实时钟):让已 resolve 的 worker 走完 补位→起跑 的续延链。 */
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it("并发不超上限,完成即补位,全量处理", async () => {
    const started: number[] = [];
    const gates = new Map<number, PromiseWithResolvers<void>>();
    const run = mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n);
      gates.set(n, Promise.withResolvers());
      await gates.get(n)!.promise;
    });
    await flush();
    expect(started).toEqual([1, 2, 3]); /* 上限 3,其余未起 */
    gates.get(3)!.resolve();
    await flush();
    expect(started).toEqual([1, 2, 3, 4]); /* 完成一个才补位 */
    gates.get(1)!.resolve();
    gates.get(4)!.resolve();
    await flush();
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
    gates.get(2)!.resolve();
    gates.get(5)!.resolve();
    gates.get(6)!.resolve();
    await flush();
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
    gates.get(7)!.resolve();
    await run;
    expect(started).toHaveLength(7);
  });

  it("空清单与单元素清单直接完成", async () => {
    await expect(mapPool([], 6, async () => {})).resolves.toBeUndefined();
    const hit: string[] = [];
    await mapPool(["a"], 6, async (x) => {
      hit.push(x);
    });
    expect(hit).toEqual(["a"]);
  });
});
