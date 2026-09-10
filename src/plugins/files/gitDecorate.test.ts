/**
 * 文件树 Git 变更着色契约测试。
 * 覆盖:状态字母 → 颜色类(修改=蓝、新增=深绿)、祖先目录聚合、
 * 目录色优先级(红 > 蓝 > 深绿 > 琥珀)、root 尾斜杠归一、删除文件仍给存留祖先着色。
 */

import { describe, expect, it } from "vitest";
import { buildDecorationMap, mergeRepoStatusDecorations } from "./gitDecorateModel";
import type { GitFileStatus } from "@kernel/ipc";

const ADDED = "text-(--tmd-git-tree-added)";
const MODIFIED = "text-(--tmd-git-tree-modified)";
const RED = "text-(--tmd-diff-removed)";
const RENAME = "text-(--tmd-git-modified)";

function f(path: string, status: GitFileStatus["status"]): GitFileStatus {
  return { path, status, staged: false, wt: true, oldPath: null };
}

describe("buildDecorationMap", () => {
  it("未跟踪文件与其全部祖先目录 → 深绿", () => {
    const m = buildDecorationMap("/ws", [f("src/app/main.ts", "?")]);
    expect(m.get("/ws/src/app/main.ts")).toBe(ADDED);
    expect(m.get("/ws/src/app")).toBe(ADDED);
    expect(m.get("/ws/src")).toBe(ADDED);
    expect(m.size).toBe(3);
  });

  it("修改文件 → 蓝", () => {
    const m = buildDecorationMap("/ws", [f("README.md", "M")]);
    expect(m.get("/ws/README.md")).toBe(MODIFIED);
    expect(m.has("/ws")).toBe(false); // 根层文件无祖先目录,root 行也不在树中渲染
  });

  it("混合目录取优先级:含修改 > 含新增", () => {
    const m = buildDecorationMap("/ws", [f("pkg/new.ts", "?"), f("pkg/old.ts", "M")]);
    expect(m.get("/ws/pkg")).toBe(MODIFIED);
  });

  it("同目录同时存在增删时红最高", () => {
    const m = buildDecorationMap("/ws", [f("a/added.ts", "A"), f("a/gone.ts", "D")]);
    expect(m.get("/ws/a")).toBe(RED);
  });

  it("已删除文件本身入表,存留祖先目录照样着色", () => {
    const m = buildDecorationMap("/ws", [f("docs/deleted.md", "D")]);
    expect(m.get("/ws/docs/deleted.md")).toBe(RED);
    expect(m.get("/ws/docs")).toBe(RED);
  });

  it("root 尾斜杠归一,不产生双斜杠键", () => {
    const m = buildDecorationMap("/ws/", [f("x.ts", "?")]);
    expect(m.has("/ws//x.ts")).toBe(false);
    expect(m.get("/ws/x.ts")).toBe(ADDED);
  });

  it("rename → 琥珀;未知状态字母跳过不入表", () => {
    const m = buildDecorationMap("/ws", [
      f("n.ts", "R"),
      { path: "o.ts", status: "X" as never, staged: false, wt: true, oldPath: null },
    ]);
    expect(m.get("/ws/n.ts")).toBe(RENAME);
    expect(m.has("/ws/o.ts")).toBe(false);
  });
});

describe("mergeRepoStatusDecorations(多仓合并)", () => {
  it("跨仓合并:各仓文件与仓内祖先各自着色,聚合不越仓界、不越 workspace 根", () => {
    const m = mergeRepoStatusDecorations([
      { root: "/ws/a", files: [f("src/x.ts", "M")] },
      { root: "/ws/b", files: [f("y.ts", "?")] },
    ]);
    expect(m.get("/ws/a/src/x.ts")).toBe(MODIFIED);
    expect(m.get("/ws/a/src")).toBe(MODIFIED);
    expect(m.get("/ws/b/y.ts")).toBe(ADDED);
    expect(m.get("/ws/b")).toBe(ADDED); // 仓根按该仓聚合着色
    expect(m.has("/ws")).toBe(false);
    expect(m.has("/ws/a/other")).toBe(false);
  });

  it("内层仓覆盖外层声明:仓根取最近祖先仓状态", () => {
    // 外层 /ws/a 声明内嵌目录 b 未跟踪(绿);内层 /ws/a/b 有修改 → 仓根蓝
    const m = mergeRepoStatusDecorations([
      { root: "/ws/a", files: [f("b", "?"), f("top.ts", "?")] },
      { root: "/ws/a/b", files: [f("deep.ts", "M")] },
    ]);
    expect(m.get("/ws/a/b")).toBe(MODIFIED);
    expect(m.get("/ws/a/b/deep.ts")).toBe(MODIFIED);
    expect(m.get("/ws/a")).toBe(ADDED); // 外层仓根按外层自己的聚合
  });

  it("仓根色取该仓最高优先级(红 > 蓝 > 深绿);仓干净不虚构着色", () => {
    const dirty = mergeRepoStatusDecorations([
      { root: "/ws/a", files: [f("x.ts", "M"), f("y.ts", "D")] },
    ]);
    expect(dirty.get("/ws/a")).toBe(RED);
    const clean = mergeRepoStatusDecorations([
      { root: "/ws/a", files: [f("top.ts", "?")] },
      { root: "/ws/a/b", files: [] },
    ]);
    expect(clean.has("/ws/a/b")).toBe(false);
  });
});
