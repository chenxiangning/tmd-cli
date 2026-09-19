/**
 * sectionCollapsed 契约(侧栏段折叠 store,pinned/running 双例):
 * 惰性首读:模块加载不读盘,首次消费才取 localStorage;预置 "1" 首读即折叠,
 * 预置 "0" 或缺失为展开;首读值随后缓存,不再回读;
 * set(true/false) 持久化为 "1"/"0";同值 set 静默(不通知、不重写);
 * 值变更通知订阅者;pinned 与 running 各持一键,互不串扰。
 * 手法:react 的 useSyncExternalStore 以接缝桩顶替(记录 subscribe/getSnapshot,
 * 普通调用挂钩);localStorage 用内存 stub;store 是模块级单例,每个用例经
 * vi.resetModules + 动态 import 取全新实例(惰性读缓存收在闭包里)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((fn: () => void) => () => void),
  getSnapshot: undefined as undefined | (() => unknown),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (fn: () => void) => () => void, getSnapshot: () => unknown) => {
    seam.subscribe = subscribe;
    seam.getSnapshot = getSnapshot;
    return getSnapshot();
  },
}));

type Mod = typeof import("./sectionCollapsed");
let mod: Mod;
let backing: Map<string, string>;
let writes: string[];

const load = async (preset: Record<string, string> = {}) => {
  backing = new Map(Object.entries(preset));
  writes = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(`${k}=${v}`);
      backing.set(k, v);
    },
  });
  vi.resetModules();
  seam.subscribe = undefined;
  seam.getSnapshot = undefined;
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mod = await import("./sectionCollapsed");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sectionCollapsed", () => {
  it("未预置时首读为展开(false),且模块加载零写盘", async () => {
    await load();
    mod.pinnedSection.use(); // 挂接订阅接缝
    expect(seam.getSnapshot?.()).toBe(false);
    expect(writes).toEqual([]);
  });

  it("预置 \"1\" 首读即折叠;预置 \"0\" 为展开", async () => {
    await load({ "tmd.pinnedSectionCollapsed": "1" });
    mod.pinnedSection.use();
    expect(seam.getSnapshot?.()).toBe(true);
    await load({ "tmd.pinnedSectionCollapsed": "0" });
    mod.pinnedSection.use();
    expect(seam.getSnapshot?.()).toBe(false);
  });

  it("set 落盘 \"1\"/\"0\" 并通知订阅者", async () => {
    await load();
    mod.pinnedSection.use();
    const seen: unknown[] = [];
    seam.subscribe!(() => void seen.push(seam.getSnapshot?.()));
    mod.pinnedSection.set(true);
    expect(backing.get("tmd.pinnedSectionCollapsed")).toBe("1");
    mod.pinnedSection.set(false);
    expect(backing.get("tmd.pinnedSectionCollapsed")).toBe("0");
    expect(seen).toEqual([true, false]);
  });

  it("同值 set 静默:不重复写盘、不通知;值变化后恢复通知", async () => {
    await load();
    mod.pinnedSection.use();
    const spy = vi.fn();
    seam.subscribe!(spy);
    mod.pinnedSection.set(true);
    mod.pinnedSection.set(true);
    expect(writes).toEqual(["tmd.pinnedSectionCollapsed=1"]);
    expect(spy).toHaveBeenCalledTimes(1);
    mod.pinnedSection.set(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("pinned 与 running 各持一键,互不串扰", async () => {
    await load({ "tmd.runningSectionCollapsed": "1" });
    mod.pinnedSection.use();
    const pinnedSpy = vi.fn();
    seam.subscribe!(pinnedSpy);
    expect(seam.getSnapshot?.()).toBe(false); // running 预置不波及 pinned

    mod.runningSection.use(); // 接缝切到 running
    expect(seam.getSnapshot?.()).toBe(true);
    const runningSpy = vi.fn();
    seam.subscribe!(runningSpy);
    mod.runningSection.set(false);
    expect(runningSpy).toHaveBeenCalledTimes(1);
    expect(pinnedSpy).not.toHaveBeenCalled();
    expect(backing.has("tmd.pinnedSectionCollapsed")).toBe(false);
    expect(backing.get("tmd.runningSectionCollapsed")).toBe("0");
  });
});
