/**
 * sidebarActions 契约(左下角设置簇动作注册表,模块级单例):
 * registerSidebarAction 追加并按 order 升序(缺省 = 0);重复 id 抛错且注册表不变;
 * removeSidebarAction 幂等(未存在静默,且不触发订阅通知);
 * defaultPinnedActionIds 只取 defaultPinned 项;useSidebarActions 读快照,
 * 注册/移除换快照并通知订阅者;移除后原 id 可重新注册。
 * react 以最小桩替代(useSyncExternalStore 直取快照,并捕获订阅回调供断言)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarAction } from "./sidebarActions";

const reactMock = vi.hoisted(() => ({
  subs: [] as Array<(cb: () => void) => () => void>,
}));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
    reactMock.subs.push(subscribe);
    return getSnapshot();
  },
}));

type SidebarActionsModule = typeof import("./sidebarActions");

/* 动态 import 例外:注册表是模块级单例,静态 import 无法跨用例重置。 */
const load = (): Promise<SidebarActionsModule> => import("./sidebarActions");

function actionOf(id: string, order?: number, defaultPinned?: boolean): SidebarAction {
  return {
    id,
    label: id,
    icon: () => null,
    order,
    defaultPinned,
    onSelect: () => undefined,
  };
}

beforeEach(() => {
  vi.resetModules();
  reactMock.subs = [];
});

describe("registerSidebarAction", () => {
  it("追加注册并按 order 升序排列,缺省 order 视为 0", async () => {
    const mod = await load();
    mod.registerSidebarAction(actionOf("c", 2));
    mod.registerSidebarAction(actionOf("a", 1));
    mod.registerSidebarAction(actionOf("b"));
    expect(mod.useSidebarActions().map((a) => a.id)).toEqual(["b", "a", "c"]);
  });

  it("重复 id 抛错且注册表保持不变", async () => {
    const mod = await load();
    mod.registerSidebarAction(actionOf("settings"));
    expect(() => mod.registerSidebarAction(actionOf("settings"))).toThrow(
      "侧栏动作重复注册: settings",
    );
    expect(mod.useSidebarActions().map((a) => a.id)).toEqual(["settings"]);
  });

  it("注册换快照并通知已订阅回调", async () => {
    const mod = await load();
    mod.useSidebarActions();
    expect(reactMock.subs).toHaveLength(1);
    const notified = vi.fn();
    reactMock.subs[0](notified);
    mod.registerSidebarAction(actionOf("x"));
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe("removeSidebarAction", () => {
  it("移除已有动作;未存在 id 静默且不通知", async () => {
    const mod = await load();
    mod.registerSidebarAction(actionOf("a"));
    mod.useSidebarActions();
    const notified = vi.fn();
    reactMock.subs[0](notified);

    mod.removeSidebarAction("a");
    expect(mod.useSidebarActions()).toHaveLength(0);
    expect(notified).toHaveBeenCalledTimes(1);

    mod.removeSidebarAction("not-registered");
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("移除后原 id 可重新注册(插件重插恢复语义)", async () => {
    const mod = await load();
    mod.registerSidebarAction(actionOf("git", 1));
    mod.removeSidebarAction("git");
    mod.registerSidebarAction(actionOf("git", 1));
    expect(mod.useSidebarActions().map((a) => a.id)).toEqual(["git"]);
  });
});

describe("defaultPinnedActionIds", () => {
  it("只取 defaultPinned 项,顺序跟注册表", async () => {
    const mod = await load();
    mod.registerSidebarAction(actionOf("b", 2, true));
    mod.registerSidebarAction(actionOf("a", 1));
    mod.registerSidebarAction(actionOf("c", 3, true));
    expect(mod.defaultPinnedActionIds()).toEqual(["b", "c"]);
  });

  it("移除动作后其默认钉住 id 一并消失", async () => {
    const mod = await load();
    mod.registerSidebarAction(actionOf("git", 1, true));
    expect(mod.defaultPinnedActionIds()).toEqual(["git"]);
    mod.removeSidebarAction("git");
    expect(mod.defaultPinnedActionIds()).toEqual([]);
  });
});
