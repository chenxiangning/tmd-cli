/**
 * 文件缓存 + 草稿 + 行尾保持 的纯逻辑契约测试。
 * 模块级单例(drafts/fileCache 为模块态),每用例 vi.resetModules 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type CacheModule = typeof import("./fileCache");

let cache: CacheModule;

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块持有模块级缓存状态,必须借 resetModules 隔离
  cache = await import("./fileCache");
});

describe("cache LRU", () => {
  it("cacheSet/cacheGet 往返,命中提新", () => {
    cache.cacheSet("/a", { path: "/a", content: "a", error: null, loaded: true });
    cache.cacheSet("/b", { path: "/b", content: "b", error: null, loaded: true });
    expect(cache.cacheGet("/a")?.content).toBe("a");
    expect(cache.cacheGet("/b")?.content).toBe("b");
  });

  it("cacheRefreshContent 原地刷新已存在条目", () => {
    cache.cacheSet("/a", { path: "/a", content: "old", error: null, loaded: true });
    cache.cacheRefreshContent("/a", "new");
    expect(cache.cacheGet("/a")?.content).toBe("new");
  });

  it("cacheDeletePrefix 清自身与子孙,不动兄弟", () => {
    cache.cacheSet("/w/a.ts", { path: "/w/a.ts", content: "1", error: null, loaded: true });
    cache.cacheSet("/w/sub/b.ts", { path: "/w/sub/b.ts", content: "2", error: null, loaded: true });
    cache.cacheSet("/w-else/c.ts", { path: "/w-else/c.ts", content: "3", error: null, loaded: true });
    cache.cacheDeletePrefix("/w");
    expect(cache.cacheGet("/w/a.ts")).toBeUndefined();
    expect(cache.cacheGet("/w/sub/b.ts")).toBeUndefined();
    expect(cache.cacheGet("/w-else/c.ts")?.content).toBe("3");
  });

  it("前缀匹配双分隔符:Windows 反斜杠子孙同样命中", () => {
    cache.cacheSet("C:\\w\\a.ts", { path: "C:\\w\\a.ts", content: "1", error: null, loaded: true });
    cache.cacheSet("C:\\w-else\\c.ts", { path: "C:\\w-else\\c.ts", content: "3", error: null, loaded: true });
    cache.cacheDeletePrefix("C:\\w");
    expect(cache.cacheGet("C:\\w\\a.ts")).toBeUndefined();
    expect(cache.cacheGet("C:\\w-else\\c.ts")?.content).toBe("3");
    expect(cache.pathEqualsOrUnder("C:\\w\\sub\\b.ts", "C:\\w")).toBe(true);
    expect(cache.pathEqualsOrUnder("C:\\w-else\\c.ts", "C:\\w")).toBe(false);
  });
});

describe("drafts", () => {
  it("set/get/delete 往返", () => {
    cache.draftSet("/a", "draft");
    expect(cache.draftGet("/a")).toBe("draft");
    cache.draftDelete("/a");
    expect(cache.draftGet("/a")).toBeUndefined();
  });

  it("draftDeletePrefix 清自身与子孙", () => {
    cache.draftSet("/w/a.ts", "1");
    cache.draftSet("/w/sub/b.ts", "2");
    cache.draftSet("/x/c.ts", "3");
    cache.draftDeletePrefix("/w");
    expect(cache.draftGet("/w/a.ts")).toBeUndefined();
    expect(cache.draftGet("/w/sub/b.ts")).toBeUndefined();
    expect(cache.draftGet("/x/c.ts")).toBe("3");
  });

  it("draftRenamePrefix 迁移自身与子孙到新前缀", () => {
    cache.draftSet("/w/old/a.ts", "1");
    cache.draftSet("/w/old/sub/b.ts", "2");
    cache.draftSet("/w/other.ts", "3");
    cache.draftRenamePrefix("/w/old", "/w/new");
    expect(cache.draftGet("/w/new/a.ts")).toBe("1");
    expect(cache.draftGet("/w/new/sub/b.ts")).toBe("2");
    expect(cache.draftGet("/w/old/a.ts")).toBeUndefined();
    expect(cache.draftGet("/w/other.ts")).toBe("3");
  });
});

describe("行尾保持", () => {
  it("CRLF 文件载入归一,保存还原", () => {
    const { text, hasCRLF } = cache.toEditorContent("a\r\nb\r\n");
    expect(hasCRLF).toBe(true);
    expect(text).toBe("a\nb\n");
    expect(cache.toDiskContent(text, hasCRLF)).toBe("a\r\nb\r\n");
  });

  it("LF 文件原样往返", () => {
    const { text, hasCRLF } = cache.toEditorContent("a\nb\n");
    expect(hasCRLF).toBe(false);
    expect(text).toBe("a\nb\n");
    expect(cache.toDiskContent(text, hasCRLF)).toBe("a\nb\n");
  });

  it("混合行尾按首个 CRLF 判定,归一覆盖全部", () => {
    const { text, hasCRLF } = cache.toEditorContent("a\r\nb\n");
    expect(hasCRLF).toBe(true);
    expect(text).toBe("a\nb\n");
  });
});
