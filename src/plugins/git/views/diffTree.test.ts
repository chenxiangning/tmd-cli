/**
 * buildTree 契约:一级目录分组 + 目录按名排序 + 根文件在前。
 * 关键防御:file.path 永远保持完整仓库相对路径(勾选/stage 依赖),
 * 截断只是渲染层的事 —— 回归 v0.1 把 path 截断导致 stage 404 的 bug。
 */

import { describe, expect, it } from "vitest";
import type { GitFileStatus } from "@kernel/ipc";
import { buildTree } from "./diffTree";

function f(path: string): GitFileStatus {
  return { path, status: "M", staged: false, wt: true };
}

describe("buildTree", () => {
  it("根文件在前,目录组按名排序", () => {
    const rows = buildTree([f("z.ts"), f("kernel/cli.ts"), f("a.ts"), f("app/x.ts")]);
    expect(rows[0]).toEqual({ depth: 0, file: f("z.ts") });
    expect(rows[1]).toEqual({ depth: 0, file: f("a.ts") });
    expect(rows[2]).toEqual({ dir: "app" });
    expect(rows[3]).toEqual({ depth: 1, file: f("app/x.ts") });
    expect(rows[4]).toEqual({ dir: "kernel" });
    expect(rows[5]).toEqual({ depth: 1, file: f("kernel/cli.ts") });
  });

  it("file.path 保持完整路径(不被截断)", () => {
    const rows = buildTree([f("kernel/cli.ts")]);
    const row = rows[1];
    if (!("file" in row)) throw new Error("expected file row");
    expect(row.file.path).toBe("kernel/cli.ts");
  });

  it("多级目录只收一级", () => {
    const rows = buildTree([f("a/b/c.ts")]);
    expect(rows[0]).toEqual({ dir: "a" });
    const row = rows[1];
    if (!("file" in row)) throw new Error("expected file row");
    expect(row.file.path).toBe("a/b/c.ts"); // 完整路径
    expect(row.depth).toBe(1);
  });

  it("空输入 → 空输出", () => {
    expect(buildTree([])).toEqual([]);
  });
});
