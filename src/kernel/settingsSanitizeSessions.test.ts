/**
 * 会话/工作区设置域清洗契约测试。
 * 被测:settingsSanitizeSessions.ts(7 个导出清洗函数)+ settingsSanitizeWorkspace.ts(2 个,小兄弟模块并入)。
 * 契约清单:
 * - 非法输入(null/标量/数组)回落空对象/空数组,不抛错
 * - 合法值原样透传(标题 trim+截断除外)
 * - 边界:空串 key/值、负数/NaN/Infinity 时间戳、畸形 entry、重复 id
 * - 确定性兜底:超上限按 key 序限量纳入(500/200/2000/100)
 * - 引擎收藏 key 形状 engineId@semver;scope 只收 global|workspace
 * - 工作区折叠图只收 boolean;分组 name trim 后非空、截断 60、id 去重
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeSessionTitles,
  sanitizeSessionPins,
  sanitizeSessionArchive,
  sanitizeSessionDeleted,
  sanitizeSessionKeep,
  sanitizeEngineVersionFavs,
} from "./settingsSanitizeSessions";
import { sanitizeWorkspaceCollapsedMap, sanitizeWorkspaceGroups } from "./settingsSanitizeWorkspace";

describe("sanitizeSessionTitles", () => {
  it("非法输入回落空对象(空数组因 typeof object 漏过守卫,返回空对象)", () => {
    for (const bad of [null, undefined, 42, "x", true, []]) {
      expect(sanitizeSessionTitles(bad)).toEqual({});
    }
  });

  it("【可疑】数组输入漏过类型守卫,索引被当 key", () => {
    // 疑似源码问题:raw 未排除 Array,["a"] 被当 {0:"a"} 处理 → {"0":"a"}。已写入报告,不改源码。
    expect(sanitizeSessionTitles(["a"])).toEqual({ "0": "a" });
  });

  it("合法值 trim 后透传,空白值丢弃", () => {
    expect(sanitizeSessionTitles({ a: "  标题  " })).toEqual({ a: "标题" });
    expect(sanitizeSessionTitles({ a: "   ", b: "" })).toEqual({});
  });

  it("非字符串值与空 key 丢弃", () => {
    expect(sanitizeSessionTitles({ n: 1, o: { x: 1 }, "": "v" })).toEqual({});
  });

  it("超长标题截断到 200 字符", () => {
    const out = sanitizeSessionTitles({ a: "x".repeat(300) });
    expect(out.a).toHaveLength(200);
  });

  it("超上限按 key 序限量纳入 500 条", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 520; i++) raw[`k${String(i).padStart(3, "0")}`] = "t";
    const out = sanitizeSessionTitles(raw);
    expect(Object.keys(out)).toHaveLength(500);
    expect(Object.keys(out)[0]).toBe("k000");
    expect(Object.keys(out)[499]).toBe("k499");
    expect(out.k519).toBeUndefined();
  });
});

describe("sanitizeSessionPins", () => {
  it("非法输入回落空对象;数组也回落", () => {
    for (const bad of [null, "x", [], [{}]]) {
      expect(sanitizeSessionPins(bad)).toEqual({});
    }
  });

  it("合法项透传:scope/pinnedAt 取整/title 截断", () => {
    const out = sanitizeSessionPins({
      s1: { scope: "global", pinnedAt: 100.7, title: " t " },
      s2: { scope: "workspace", pinnedAt: 0 },
    });
    expect(out.s1).toEqual({ scope: "global", pinnedAt: 100, title: "t" });
    expect(out.s2).toEqual({ scope: "workspace", pinnedAt: 0, title: "" });
  });

  it("非法 scope、负数/非有限时间戳、畸形值丢弃", () => {
    const out = sanitizeSessionPins({
      a: { scope: "bogus", pinnedAt: 1 },
      b: { scope: "global", pinnedAt: -1 },
      c: { scope: "global", pinnedAt: Number.NaN },
      d: { scope: "global", pinnedAt: Number.POSITIVE_INFINITY },
      e: { scope: "global", pinnedAt: "1" },
      f: null,
      g: "x",
    });
    expect(out).toEqual({});
  });

  it("超上限按 key 序限量纳入 200 条", () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 210; i++) raw[`k${String(i).padStart(3, "0")}`] = { scope: "global", pinnedAt: i };
    const out = sanitizeSessionPins(raw);
    expect(Object.keys(out)).toHaveLength(200);
    expect(Object.keys(out)[199]).toBe("k199");
    expect(out.k209).toBeUndefined();
  });
});

describe("sanitizeSessionArchive / sanitizeSessionDeleted / sanitizeSessionKeep", () => {
  const cases = [
    { fn: sanitizeSessionArchive, field: "archivedAt" },
    { fn: sanitizeSessionDeleted, field: "deletedAt" },
    { fn: sanitizeSessionKeep, field: "keptAt" },
  ] as const;

  for (const { fn, field } of cases) {
    it(`${fn.name}: 非法输入回落空对象`, () => {
      for (const bad of [null, "x", 1, []]) expect(fn(bad)).toEqual({});
    });

    it(`${fn.name}: 合法时间戳透传并取整,非法值丢弃`, () => {
      expect(fn({ ok: { [field]: 12.9 } })).toEqual({ ok: { [field]: 12 } });
      expect(
        fn({ neg: { [field]: -5 }, nan: { [field]: Number.NaN }, str: { [field]: "1" }, nul: null }),
      ).toEqual({});
    });

    it(`${fn.name}: 超上限按 key 序限量纳入`, () => {
      const cap = fn === sanitizeSessionArchive ? 2000 : 200;
      const raw: Record<string, unknown> = {};
      for (let i = 0; i < cap + 10; i++) raw[`k${String(i).padStart(5, "0")}`] = { [field]: i };
      const out = fn(raw);
      expect(Object.keys(out)).toHaveLength(cap);
      expect(Object.keys(out)[cap - 1]).toBe(`k${String(cap - 1).padStart(5, "0")}`);
      expect(Object.keys(out).length < cap + 10).toBe(true);
    });
  }
});

describe("sanitizeEngineVersionFavs", () => {
  it("非法输入回落空对象", () => {
    for (const bad of [null, undefined, [], "x"]) expect(sanitizeEngineVersionFavs(bad)).toEqual({});
  });

  it("合法 key(engineId@semver)透传,畸形 key 丢弃", () => {
    expect(sanitizeEngineVersionFavs({ "claude@4.1.0": { favedAt: 5.5 } })).toEqual({
      "claude@4.1.0": { favedAt: 5 },
    });
    expect(
      sanitizeEngineVersionFavs({
        "no-semver@1.2": { favedAt: 1 },
        "has space@1.2.3": { favedAt: 1 },
        "@1.2.3": { favedAt: 1 },
        "a@b": { favedAt: 1 },
      }),
    ).toEqual({});
  });

  it("负数/非有限 favedAt 与畸形值丢弃", () => {
    expect(
      sanitizeEngineVersionFavs({
        "a@1.0.0": { favedAt: -1 },
        "b@1.0.0": { favedAt: Infinity },
        "c@1.0.0": "x",
      }),
    ).toEqual({});
  });

  it("超上限按 key 序限量纳入 100 条", () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 110; i++) raw[`e${String(i).padStart(3, "0")}@1.0.0`] = { favedAt: i };
    const out = sanitizeEngineVersionFavs(raw);
    expect(Object.keys(out)).toHaveLength(100);
    expect(Object.keys(out)[99]).toBe("e099@1.0.0");
  });
});

describe("sanitizeWorkspaceCollapsedMap", () => {
  it("非法输入回落空对象", () => {
    for (const bad of [null, "x", 1, []]) expect(sanitizeWorkspaceCollapsedMap(bad)).toEqual({});
  });

  it("只收 boolean 值,其余类型丢弃", () => {
    expect(sanitizeWorkspaceCollapsedMap({ a: true, b: false, c: "true", d: 0, e: null })).toEqual({
      a: true,
      b: false,
    });
  });

  it("超上限按 key 序限量纳入 200 条", () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 210; i++) raw[`w${String(i).padStart(3, "0")}`] = true;
    const out = sanitizeWorkspaceCollapsedMap(raw);
    expect(Object.keys(out)).toHaveLength(200);
    expect(Object.keys(out)[199]).toBe("w199");
  });
});

describe("sanitizeWorkspaceGroups", () => {
  it("非数组回落空数组", () => {
    for (const bad of [null, "x", {}, 3]) expect(sanitizeWorkspaceGroups(bad)).toEqual([]);
  });

  it("合法项透传且 name trim;前后空白剥除", () => {
    expect(sanitizeWorkspaceGroups([{ id: "g1", name: " 前端 " }])).toEqual([{ id: "g1", name: "前端" }]);
  });

  it("非对象项、空 id、重复 id、空白 name 丢弃", () => {
    expect(
      sanitizeWorkspaceGroups([
        null,
        "x",
        { id: "", name: "a" },
        { id: "dup", name: "a" },
        { id: "dup", name: "b" },
        { id: "g2", name: "   " },
        { id: "g3" },
      ]),
    ).toEqual([{ id: "dup", name: "a" }]);
  });

  it("超长 name 截断到 60 字符", () => {
    const out = sanitizeWorkspaceGroups([{ id: "g", name: "长".repeat(80) }]);
    expect(out[0].name).toHaveLength(60);
  });

  it("超上限限量纳入 100 条", () => {
    const raw = Array.from({ length: 110 }, (_, i) => ({ id: `g${i}`, name: `n${i}` }));
    expect(sanitizeWorkspaceGroups(raw)).toHaveLength(100);
  });
});
