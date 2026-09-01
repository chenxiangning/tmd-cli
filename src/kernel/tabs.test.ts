/**
 * 编辑器标签页 store 行为契约测试。
 * 覆盖:open 新增/去重激活、close 后激活回退、空列表边界、
 * 不变量「activeId 始终指向存在的 tab」。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorTab } from "./tabs";

type TabsModule = typeof import("./tabs");

let tabs: TabsModule;

function tab(id: string, overrides: Partial<EditorTab> = {}) {
  return { id, title: id, path: `/p/${id}`, kind: "file", payload: null, ...overrides };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  tabs = await import("./tabs");
});

describe("openTab", () => {
  it("新增 tab 入列并激活", () => {
    tabs.openTab(tab("a"));
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
    expect(tabs.getActiveTabId()).toBe("a");
  });

  it("重复 id 不重复入列,仅切换激活", () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    tabs.openTab(tab("a", { title: "a-renewed" }));
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a", "b"]);
    expect(tabs.getActiveTabId()).toBe("a");
    // 去重语义:保留首次注册的条目,不覆盖
    expect(tabs.getTabs()[0].title).toBe("a");
  });
});

describe("closeTab", () => {
  it("关闭激活 tab 后,激活回退到首个剩余 tab", () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    tabs.openTab(tab("c"));
    tabs.closeTab("c");
    expect(tabs.getActiveTabId()).toBe("a");
  });

  it("关闭非激活 tab 不影响激活态", () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    tabs.setActiveTab("a");
    tabs.closeTab("b");
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
    expect(tabs.getActiveTabId()).toBe("a");
  });

  it("关闭不存在的 id:列表与激活态均不变", () => {
    tabs.openTab(tab("a"));
    tabs.closeTab("ghost");
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
    expect(tabs.getActiveTabId()).toBe("a");
  });

  it("全部关闭后 activeId 回落 null(空列表边界)", () => {
    tabs.openTab(tab("a"));
    tabs.closeTab("a");
    expect(tabs.getTabs()).toEqual([]);
    expect(tabs.getActiveTabId()).toBeNull();
  });
});

describe("setActiveTab 不变量", () => {
  it("切换到已存在 id 生效", () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    tabs.setActiveTab("a");
    expect(tabs.getActiveTabId()).toBe("a");
  });

  it("指向不存在 id 时回退到首个 tab,activeId 不悬空", () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    tabs.setActiveTab("ghost");
    expect(tabs.getActiveTabId()).toBe("a");
  });

  it("空列表上 setActiveTab 任意值,activeId 保持 null", () => {
    tabs.setActiveTab("ghost");
    expect(tabs.getActiveTabId()).toBeNull();
  });
});
