/**
 * searchLogic 契约(D-04 三作用域回归矩阵之全文/快开侧):
 * - 全文分组:按文件聚合且保持首见顺序(行序即 walk 序自然递增);
 * - 全文上限常量 2000(护栏在后端,前端透传同值);
 * - 快开:空查询 = walk 序前 50 零分通过;非空 = fuzzy 子序列过滤 +
 *   分降序(同分路径字典序)截 50;超 50 截断提示由 rows.length === SHOW_LIMIT 判定。
 */
import { describe, expect, it } from "vitest";
import { groupByFile, quickOpenRows, MAX_RESULTS, SHOW_LIMIT, WALK_CAP } from "./searchLogic";

describe("groupByFile 全文分组", () => {
  it("按文件聚合、保持首见顺序、行序不变", () => {
    const hits = [
      { path: "/a.ts", line: 1 },
      { path: "/b.ts", line: 3 },
      { path: "/a.ts", line: 9 },
      { path: "/c.ts", line: 2 },
    ];
    const groups = groupByFile(hits);
    expect([...groups.keys()]).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
    expect(groups.get("/a.ts")?.map((h) => h.line)).toEqual([1, 9]);
    expect(groups.get("/b.ts")?.map((h) => h.line)).toEqual([3]);
  });

  it("上限常量:全文 2000 / walk 5000 / 展示 50", () => {
    expect(MAX_RESULTS).toBe(2000);
    expect(WALK_CAP).toBe(5000);
    expect(SHOW_LIMIT).toBe(50);
  });
});

describe("quickOpenRows 快开行构造", () => {
  it("空查询:walk 序前 50 零分通过(全量列表语义)", () => {
    const files = Array.from({ length: 60 }, (_, i) => `/f${String(i).padStart(2, "0")}.ts`);
    const rows = quickOpenRows(files, "  ");
    expect(rows).toHaveLength(SHOW_LIMIT);
    expect(rows[0]).toEqual({ path: "/f00.ts", score: 0, indices: [] });
    expect(rows.at(-1)?.path).toBe("/f49.ts");
  });

  it("非查询子序列的路径滤除;命中按分降序、同分字典序,截 50", () => {
    const files = ["/src/abc.ts", "/src/axc.ts", "/lab/note.md"];
    const rows = quickOpenRows(files, "ab");
    /* axc 无 b(非子序列)被滤除;acb 类乱序也不命中 fuzzy 语义。 */
    expect(rows.map((r) => r.path)).toEqual(["/src/abc.ts", "/lab/note.md"]);
    /* ab 在 abc(词首连续)得分高于 lab(段中靠后):排序而非纯字典序 */
    expect(rows[0].path).toBe("/src/abc.ts");
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
    expect(rows.every((r) => r.indices.length > 0)).toBe(true);
  });

  it("命中超 50 截顶(截断提示判定条件 rows.length === SHOW_LIMIT)", () => {
    const files = Array.from({ length: 80 }, (_, i) => `/match${String(i).padStart(2, "0")}/x.ts`);
    const rows = quickOpenRows(files, "match");
    expect(rows).toHaveLength(SHOW_LIMIT);
  });
});
