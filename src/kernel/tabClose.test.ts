/**
 * 用户手势关闭协调器契约测试(kernel/tabClose)。
 * 覆盖:无闸放行 / 闸放行 / 闸拒绝 / 闸抛错保留 / 在途去重 /
 * 陈旧确认不删新实例 / 批量逐个过闸。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取同一代的全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorTab } from "./tabs";

type TabsModule = typeof import("./tabs");
type TabCloseModule = typeof import("./tabClose");

let tabs: TabsModule;
let tabClose: TabCloseModule;

const GATED = "gated";

function tab(id: string, overrides: Partial<EditorTab> = {}) {
  return { id, title: id, path: `/p/${id}`, kind: "file", payload: null, ...overrides };
}

/** 注册一个带闸的 kind;闸为 undefined = 只注册内容不注册闸。 */
function registerGated(guard?: (tab: EditorTab) => boolean | Promise<boolean>) {
  tabs.registerTabContent({
    kind: GATED,
    component: () => null,
    ...(guard ? { beforeClose: guard } : {}),
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  tabs = await import("./tabs");
  tabClose = await import("./tabClose");
});

describe("requestCloseTab", () => {
  it("未注册 beforeClose 的 kind:直接关闭(全插件行为零变化)", async () => {
    tabs.openTab(tab("a"));
    await expect(tabClose.requestCloseTab("a")).resolves.toBe(true);
    expect(tabs.getTabs()).toEqual([]);
  });

  it("闸放行:关闭并返回 true", async () => {
    registerGated(() => true);
    tabs.openTab(tab("a", { kind: GATED }));
    await expect(tabClose.requestCloseTab("a")).resolves.toBe(true);
    expect(tabs.getTabs()).toEqual([]);
  });

  it("闸拒绝:保留 tab,返回 false", async () => {
    registerGated(() => false);
    tabs.openTab(tab("a", { kind: GATED }));
    await expect(tabClose.requestCloseTab("a")).resolves.toBe(false);
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
  });

  it("闸抛错:按不放行处理(保留 tab 可重试,不静默丢稿)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerGated(() => {
      throw new Error("闸内部炸了");
    });
    tabs.openTab(tab("a", { kind: GATED }));
    await expect(tabClose.requestCloseTab("a")).resolves.toBe(false);
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalled();
  });

  it("关闭不存在的 id:返回 false,列表不变", async () => {
    tabs.openTab(tab("a"));
    await expect(tabClose.requestCloseTab("ghost")).resolves.toBe(false);
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
  });

  it("在途去重:确认未结算时连点两次,闸只被问一次", async () => {
    let settle: (ok: boolean) => void = () => {};
    const guard = vi.fn(
      () => new Promise<boolean>((resolve) => (settle = resolve)),
    );
    registerGated(guard);
    tabs.openTab(tab("a", { kind: GATED }));

    const first = tabClose.requestCloseTab("a");
    const second = tabClose.requestCloseTab("a");
    expect(guard).toHaveBeenCalledTimes(1);

    settle(true);
    /* 先到者真关掉;后者复用同一确认,但此刻 tab 已不在 = 如实返回 false */
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(tabs.getTabs()).toEqual([]);
  });

  it("陈旧确认不删新实例:确认期间 tab 被关又重开,旧确认不生效", async () => {
    let settle: (ok: boolean) => void = () => {};
    registerGated(() => new Promise<boolean>((resolve) => (settle = resolve)));
    tabs.openTab(tab("a", { kind: GATED }));

    const pending = tabClose.requestCloseTab("a");
    /* 模拟确认弹窗未结算期间:该 id 被程序性关掉,又以新实例重开 */
    tabs.closeTab("a");
    tabs.openTab(tab("a", { kind: GATED, title: "a-renewed" }));
    settle(true);

    await expect(pending).resolves.toBe(false);
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a"]);
    expect(tabs.getTabs()[0].title).toBe("a-renewed");
  });
});

describe("requestCloseOtherTabs", () => {
  it("拒绝者留下,其余关闭;keepId 恒保留", async () => {
    registerGated((t) => t.id !== "b");
    tabs.openTab(tab("a", { kind: GATED }));
    tabs.openTab(tab("b", { kind: GATED }));
    tabs.openTab(tab("c", { kind: GATED }));
    await tabClose.requestCloseOtherTabs("a");
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("无闸 kind:等同同步 closeOtherTabs", async () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    tabs.openTab(tab("c"));
    await tabClose.requestCloseOtherTabs("b");
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["b"]);
  });
});

describe("requestCloseAllTabs", () => {
  it("逐个过闸:拒绝者留下", async () => {
    registerGated((t) => t.id !== "b");
    tabs.openTab(tab("a", { kind: GATED }));
    tabs.openTab(tab("b", { kind: GATED }));
    await tabClose.requestCloseAllTabs();
    expect(tabs.getTabs().map((t) => t.id)).toEqual(["b"]);
  });

  it("全部放行:清空列表", async () => {
    tabs.openTab(tab("a"));
    tabs.openTab(tab("b"));
    await tabClose.requestCloseAllTabs();
    expect(tabs.getTabs()).toEqual([]);
    expect(tabs.getActiveTabId()).toBeNull();
  });
});

describe("getTabCloseGuard", () => {
  it("注册带闸的 kind 可查到,未注册 kind 为 undefined", () => {
    registerGated(() => true);
    expect(typeof tabs.getTabCloseGuard(GATED)).toBe("function");
    expect(tabs.getTabCloseGuard("file")).toBeUndefined();
  });
});
