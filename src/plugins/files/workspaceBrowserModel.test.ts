import { describe, expect, it } from "vitest";
import type { GitFileStatus } from "@kernel/ipc";
import { buildLetterMap, statusLetter } from "./gitDecorateModel";
import {
  buildChangedChildren,
  filterWalkHits,
  isIgnoredPath,
  type ChangedChild,
} from "./workspaceBrowserModel";

const ROOT = "/ws";
const f = (path: string, status: GitFileStatus["status"]): GitFileStatus => ({
  path,
  status,
  staged: false,
  wt: true,
  oldPath: null,
});

describe("gitDecorateModel 字母表(侧栏浏览器消费)", () => {
  it("untracked 渲染为 U;仅文件条目入表,绝对路径口径", () => {
    expect(statusLetter("?")).toBe("U");
    expect(statusLetter("M")).toBe("M");
    const m = buildLetterMap([
      { root: `${ROOT}/`, files: [f("a.ts", "M"), f("new/", "?"), f("b.ts", "?")] },
    ]);
    expect(m.get(`${ROOT}/a.ts`)).toBe("M");
    expect(m.get(`${ROOT}/b.ts`)).toBe("U");
    expect(m.has(`${ROOT}/new`)).toBe(false);
  });
});

describe("isIgnoredPath", () => {
  it("自身/祖先命中前缀即忽略,.git 恒忽略", () => {
    expect(isIgnoredPath("/ws/node_modules", ["/ws/node_modules/"])).toBe(true);
    expect(isIgnoredPath("/ws/node_modules/a/b.js", ["/ws/node_modules/"])).toBe(true);
    expect(isIgnoredPath("/ws/src/a.ts", ["/ws/node_modules/"])).toBe(false);
    expect(isIgnoredPath("/ws/.git", [])).toBe(true);
    expect(isIgnoredPath("/ws/.git/objects", [])).toBe(true);
  });
});

describe("buildChangedChildren", () => {
  const childrenOf = (m: ReadonlyMap<string, readonly ChangedChild[]>, k: string) =>
    m.get(k) ?? [];

  it("祖先链成目录条目,根层含变更文件;目录在前名称升序", () => {
    const m = buildChangedChildren(ROOT, [
      f("docs/b.md", "M"),
      f("docs/a/c.md", "D"),
      f("z.ts", "A"),
    ]);
    const rootKids = childrenOf(m, ROOT);
    expect(rootKids.map((c) => c.name)).toEqual(["docs", "z.ts"]);
    expect(rootKids[0]).toMatchObject({ path: `${ROOT}/docs`, isDir: true });
    const docsKids = childrenOf(m, `${ROOT}/docs`);
    expect(docsKids.map((c) => c.name)).toEqual(["a", "b.md"]);
    expect(childrenOf(m, `${ROOT}/docs/a`)[0]).toMatchObject({
      path: `${ROOT}/docs/a/c.md`,
      isDir: false,
    });
  });

  it("重复祖先不产生重复目录条目;根尾斜杠归一", () => {
    const m = buildChangedChildren(`${ROOT}/`, [f("d/a.ts", "M"), f("d/b.ts", "M")]);
    expect(childrenOf(m, ROOT)).toHaveLength(1);
    expect(childrenOf(m, `${ROOT}/d`)).toHaveLength(2);
  });
});

describe("filterWalkHits", () => {
  it("按文件名子串大小写不敏感过滤,空查询为空", () => {
    const rels = ["src/App.tsx", "docs/README.md", "src/app.test.tsx"];
    expect(filterWalkHits(ROOT, rels, "APP")).toEqual([
      `${ROOT}/src/App.tsx`,
      `${ROOT}/src/app.test.tsx`,
    ]);
    expect(filterWalkHits(ROOT, rels, "  ")).toEqual([]);
  });
});
