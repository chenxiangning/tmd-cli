/**
 * 文件树 Git 变更着色契约测试。
 * 覆盖:状态字母 → 颜色类(修改=蓝、新增=深绿)、祖先目录聚合、
 * 目录色优先级(红 > 蓝 > 深绿 > 琥珀)、root 尾斜杠归一、删除文件仍给存留祖先着色。
 */

import { describe, expect, it } from "vitest";
import { buildDecorationMap } from "./gitDecorate";
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
