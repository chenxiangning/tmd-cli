/**
 * 草稿镜像契约测试(kernel/draftMirror)。
 * 覆盖:roundtrip / 防抖落盘与 flush 同帧补写 / 256KB 截断(标记跨重启) /
 * TTL 过期惰性清理 / 写路径台账 GC / 台账脏 JSON / clear 幂等。
 * node 环境:localStorage 用内存 stub;模块级单例,每个用例经
 * vi.resetModules + 动态 import 取全新实例(pending/timers 收在闭包里)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  draftMirrorClear,
  draftMirrorFlushAll,
  draftMirrorGet,
  draftMirrorSet,
} from "./draftMirror";

/* 类型取静态 import type(擦除,不触发模块加载);运行时实例必须动态取:
 * 被测模块是模块级单例(pending/timers/防抖收在闭包里),每个用例经
 * vi.resetModules + await import 取全新实例(仓内 tabClose.test 同手法)。 */
type Mod = {
  draftMirrorSet: typeof draftMirrorSet;
  draftMirrorGet: typeof draftMirrorGet;
  draftMirrorFlushAll: typeof draftMirrorFlushAll;
  draftMirrorClear: typeof draftMirrorClear;
};

let mod: Mod;
let backing: Map<string, string>;

function seed(key: string, value: string): void {
  backing.set(key, value);
}

function ledgerOf(): Record<string, unknown> {
  return JSON.parse(backing.get("tmd.draftMirror._ledger") ?? "{}") as Record<string, unknown>;
}

beforeEach(async () => {
  backing = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  });
  vi.resetModules();
  mod = await import("./draftMirror"); /* 见头部:单例必须动态取全新实例 */
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("draftMirror", () => {
  it("roundtrip:set 即可读(写穿缓存),flush 后落盘且台账记时", () => {
    mod.draftMirrorSet("file:/a/b.txt", "hello");
    const entry = mod.draftMirrorGet("file:/a/b.txt");
    expect(entry?.text).toBe("hello");
    expect(entry?.truncated).toBe(false);
    expect(entry?.savedAt).toBeGreaterThan(0);
    expect(backing.has("tmd.draftMirror.file:/a/b.txt")).toBe(false); /* 防抖未落盘 */

    mod.draftMirrorFlushAll();
    expect(backing.get("tmd.draftMirror.file:/a/b.txt")).toBe("hello");
    expect(typeof ledgerOf()["file:/a/b.txt"]).toBe("number");

    /* 新模块实例(模拟重启):无内存缓存,纯存储回读仍可得 */
    vi.resetModules();
    return import("./draftMirror").then((fresh) => {
      expect(fresh.draftMirrorGet("file:/a/b.txt")?.text).toBe("hello");
    });
  });

  it("256KB 截断:只留前缀,截断标记跨重启随台账存活", () => {
    const big = "x".repeat(256 * 1024 + 10);
    mod.draftMirrorSet("file:/big", big);
    const entry = mod.draftMirrorGet("file:/big");
    expect(entry?.truncated).toBe(true);
    expect(entry?.text.length).toBe(256 * 1024);

    mod.draftMirrorFlushAll();
    expect(backing.get("tmd.draftMirror.file:/big")?.length).toBe(256 * 1024);

    vi.resetModules();
    return import("./draftMirror").then((fresh) => {
      const stored = fresh.draftMirrorGet("file:/big");
      expect(stored?.truncated).toBe(true);
      expect(stored?.text.length).toBe(256 * 1024);
    });
  });

  it("TTL 过期:get 惰性清理(值键+台账一起摘)并返回 null", async () => {
    seed("tmd.draftMirror.file:/old", "stale");
    seed(
      "tmd.draftMirror._ledger",
      JSON.stringify({ "file:/old": Date.now() - 7 * 24 * 3600 * 1000 - 1000 }),
    );
    expect(mod.draftMirrorGet("file:/old")).toBeNull();
    expect(backing.has("tmd.draftMirror.file:/old")).toBe(false);
    expect(ledgerOf()["file:/old"]).toBeUndefined();
  });

  it("写路径台账 GC:set+flush 顺手老化超期他槽", () => {
    seed("tmd.draftMirror.file:/aged", "aged");
    seed(
      "tmd.draftMirror._ledger",
      JSON.stringify({ "file:/aged": Date.now() - 8 * 24 * 3600 * 1000 }),
    );
    mod.draftMirrorSet("file:/new", "fresh");
    mod.draftMirrorFlushAll();
    expect(backing.has("tmd.draftMirror.file:/aged")).toBe(false);
    expect(ledgerOf()["file:/aged"]).toBeUndefined();
    expect(backing.get("tmd.draftMirror.file:/new")).toBe("fresh");
  });

  it("台账脏 JSON:按无台账处理,孤儿值被惰性清掉", () => {
    seed("tmd.draftMirror.file:/orphan", "value");
    seed("tmd.draftMirror._ledger", "{corrupted json");
    expect(mod.draftMirrorGet("file:/orphan")).toBeNull();
    expect(backing.has("tmd.draftMirror.file:/orphan")).toBe(false);
  });

  it("clear:值键/台账/内存快照全清,再读为 null", () => {
    mod.draftMirrorSet("journal-note:2026-10-19", "draft");
    mod.draftMirrorFlushAll();
    mod.draftMirrorClear("journal-note:2026-10-19");
    expect(backing.has("tmd.draftMirror.journal-note:2026-10-19")).toBe(false);
    expect(ledgerOf()["journal-note:2026-10-19"]).toBeUndefined();
    expect(mod.draftMirrorGet("journal-note:2026-10-19")).toBeNull();
  });
});
