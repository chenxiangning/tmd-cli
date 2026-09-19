/**
 * proxyPopoverStore 契约(网络代理浮层开合,模块级 store):
 * open 记录锚点坐标并置 open;重复 open 顶替为新坐标;
 * close 关闭但保留最后一次锚点;未开时 close 幂等(不通知订阅者);
 * open/close 每次变更通知订阅者,快照整体换引用。
 * 手法:通知面只有 useSyncExternalStore —— vi.mock react 顶替为接缝桩
 * (记录 subscribe/getSnapshot),以普通函数调用挂钩后断言真实 store 行为。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

type Mod = typeof import("./proxyPopoverStore");
let mod: Mod;

beforeEach(async () => {
  vi.resetModules();
  seam.subscribe = undefined;
  seam.getSnapshot = undefined;
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mod = await import("./proxyPopoverStore");
  mod.useProxyPopoverState(); // 挂接订阅接缝(node 环境无 React 渲染)
});

describe("proxyPopoverStore", () => {
  it("open 记录锚点坐标并置 open;重复 open 顶替为新坐标", () => {
    mod.openProxyPopover(120, 80);
    expect(seam.getSnapshot?.()).toEqual({ open: true, x: 120, y: 80 });
    mod.openProxyPopover(10, 20);
    expect(seam.getSnapshot?.()).toEqual({ open: true, x: 10, y: 20 });
  });

  it("close 关闭但保留锚点;open/close 每次变更通知订阅者", () => {
    const seen: unknown[] = [];
    seam.subscribe!(() => void seen.push(seam.getSnapshot?.()));
    mod.openProxyPopover(5, 6);
    mod.closeProxyPopover();
    expect(seam.getSnapshot?.()).toEqual({ open: false, x: 5, y: 6 });
    expect(seen).toEqual([
      { open: true, x: 5, y: 6 },
      { open: false, x: 5, y: 6 },
    ]);
  });

  it("未开时 close 幂等:不通知订阅者,状态与坐标保持", () => {
    mod.openProxyPopover(1, 2);
    mod.closeProxyPopover();
    const spy = vi.fn();
    seam.subscribe!(spy);
    mod.closeProxyPopover();
    expect(spy).not.toHaveBeenCalled();
    expect(seam.getSnapshot?.()).toEqual({ open: false, x: 1, y: 2 });
  });
});
