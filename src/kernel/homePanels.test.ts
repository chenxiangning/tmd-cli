/**
 * homePanels 契约(首页引擎卡扩展面板注册表,模块级单例):
 * registerHomePanel 按 profileId 索引写入,useHomePanels 快照可见;
 * 重复 profileId 抛错且原面板保留;removeHomePanel 幂等(未存在静默不通知);
 * 注册/移除换快照并通知订阅者。
 * react 以最小桩替代(useSyncExternalStore 直取快照,并捕获订阅回调供断言)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";

const reactMock = vi.hoisted(() => ({
  subs: [] as Array<(cb: () => void) => () => void>,
}));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
    reactMock.subs.push(subscribe);
    return getSnapshot();
  },
}));

/* 动态 import 例外:注册表是模块级单例,静态 import 无法跨用例重置。 */
const load = (): Promise<typeof import("./homePanels")> => import("./homePanels");

const fakePanel: ComponentType = () => null;

beforeEach(() => {
  vi.resetModules();
  reactMock.subs = [];
});

describe("registerHomePanel", () => {
  it("按 profileId 写入注册表,useHomePanels 快照可见", async () => {
    const mod = await load();
    mod.registerHomePanel("dsh", fakePanel);
    const panels = mod.useHomePanels();
    expect(panels.get("dsh")).toBe(fakePanel);
    expect(panels.size).toBe(1);
  });

  it("重复 profileId 抛错且原面板保留", async () => {
    const mod = await load();
    const other: ComponentType = () => null;
    mod.registerHomePanel("dsh", fakePanel);
    expect(() => mod.registerHomePanel("dsh", other)).toThrow("首页引擎面板重复注册: dsh");
    expect(mod.useHomePanels().get("dsh")).toBe(fakePanel);
  });

  it("注册换快照并通知已订阅回调", async () => {
    const mod = await load();
    mod.useHomePanels();
    const notified = vi.fn();
    reactMock.subs[0](notified);
    mod.registerHomePanel("omp", fakePanel);
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe("removeHomePanel", () => {
  it("移除已注册面板并通知;未存在 id 静默不通知", async () => {
    const mod = await load();
    mod.registerHomePanel("dsh", fakePanel);
    mod.useHomePanels();
    const notified = vi.fn();
    reactMock.subs[0](notified);

    mod.removeHomePanel("dsh");
    expect(mod.useHomePanels().has("dsh")).toBe(false);
    expect(notified).toHaveBeenCalledTimes(1);

    mod.removeHomePanel("never-registered");
    expect(notified).toHaveBeenCalledTimes(1);
  });
});
