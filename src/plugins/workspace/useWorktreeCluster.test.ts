import { describe, expect, it } from "vitest";
import { clusterBuckets, type WorktreeClusterMeta } from "./useWorktreeCluster";

const meta: Record<string, WorktreeClusterMeta> = {
  "/repo": { mainRoot: "/repo", isMain: true },
  "/repo-wt-a": { mainRoot: "/repo", isMain: false },
  "/repo-wt-b": { mainRoot: "/repo", isMain: false },
};

describe("clusterBuckets", () => {
  it("同簇归一桶:主仓在 main,worktree 按原序跟随;无簇信息自成孤桶", () => {
    const buckets = clusterBuckets(
      [
        { id: "a", root: "/repo-wt-a" },
        { id: "m", root: "/repo" },
        { id: "b", root: "/repo-wt-b" },
        { id: "s", root: "/other" },
      ],
      meta,
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0].main?.id).toBe("m");
    expect(buckets[0].children.map((c) => c.id)).toEqual(["a", "b"]);
    expect(buckets[1]).toEqual({ main: null, children: [{ id: "s", root: "/other" }] });
  });

  it("主仓未加入侧栏:worktree 仍归同桶且 main 为 null", () => {
    const buckets = clusterBuckets(
      [
        { id: "a", root: "/repo-wt-a" },
        { id: "b", root: "/repo-wt-b" },
      ],
      meta,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].main).toBeNull();
    expect(buckets[0].children.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
