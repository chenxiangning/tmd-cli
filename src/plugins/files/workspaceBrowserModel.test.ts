import { describe, expect, it } from "vitest";
import type { GitFileStatus } from "@kernel/ipc";
import { buildLetterMap, statusLetter } from "./gitDecorateModel";
import {
  buildChangedChildren,
  changedTreeOf,
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

describe("changedTreeOf(多仓合并 + 深层仓补链)", () => {
  const entries = [
    { root: `${ROOT}/a/repo2`, files: [f("src/x.ts", "M")] },
    { root: `${ROOT}/top`, files: [f("t.ts", "M")] },
  ];
  const tree = changedTreeOf(ROOT, entries);

  it("深度 ≥2 嵌套仓:base→仓根中间目录成链,根层露出 a,展开可达 repo2 变更", () => {
    expect((tree.get(ROOT) ?? []).map((c) => c.name)).toEqual(["a", "top"]);
    expect(tree.get(`${ROOT}/a`)!.map((c) => c.path)).toEqual([`${ROOT}/a/repo2`]);
    expect(tree.get(`${ROOT}/a/repo2`)!.map((c) => c.name)).toEqual(["src"]);
  });

  it("干净仓也补链(空桶自身不可展开,但链通到更深的脏仓)", () => {
    const mixed = [
      { root: `${ROOT}/clean`, files: [] },
      { root: `${ROOT}/clean/dirty`, files: [f("y.ts", "?")] },
    ];
    const t = changedTreeOf(ROOT, mixed);
    expect(t.get(ROOT)!.map((c) => c.name)).toEqual(["clean"]);
    expect(t.get(`${ROOT}/clean`)!.map((c) => c.name)).toEqual(["dirty"]);
    expect(t.get(`${ROOT}/clean/dirty`)!.map((c) => c.name)).toEqual(["y.ts"]);
  });
});
