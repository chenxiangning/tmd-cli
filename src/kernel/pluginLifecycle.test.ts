/**
 * PluginLifecycle 激活编排契约测试。
 * 覆盖契约:
 * - activateAll 分波拓扑:依赖先于被依赖者激活;被拔插件不进激活循环,依赖被拔者的插件连带跳过且不误报依赖环;
 *   settingsReady 未就绪不激活,就绪后按落盘 disabledPlugins 过滤;
 *   重复激活幂等:activateAll 把激活 Promise 记忆化到实例生命周期,二次调用共享首跑(首清单定格);
 *   并发双调用共享同一激活 Promise(StrictMode 交错不双跑)。
 * - 异常隔离:activate 抛错原样上抛、失败插件零残留且贡献经账本撤销、已激活的先波插件不受牵连、激活链在失败点中断。
 * - activateLate:熔断插件拒绝;activate 抛错占位回滚(重复/缺依赖/被拔拒绝由 host.activateLate.test.ts 覆盖)。
 * - revoke:移出激活表并撤销贡献;未激活 id 无副作用。
 * - listPluginStates:全量清单 × 启用态 join,被拔者也在市场列表中(enabled=false)。
 * settings / contributionLedger / pluginQuarantine 全 mock(依赖面小且行为需可控)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin, PluginContext } from "./plugin";

const h = vi.hoisted(() => {
  const state = {
    settings: { disabledPlugins: [] as string[] },
    undone: [] as string[],
    cleanups: [] as Array<[string, () => void]>,
    attributed: [] as string[],
    quarantined: new Set<string>(),
    ready: { promise: Promise.resolve(), resolve: () => {} },
  };
  /* 逐测试重置 settingsReady:immediate=true 给已决 Promise,否则给可放行的闸门。 */
  function rearmReady(immediate = true): void {
    if (immediate) {
      state.ready = { promise: Promise.resolve(), resolve: () => {} };
      return;
    }
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    state.ready = { promise, resolve };
  }
  return { state, rearmReady };
});

vi.mock("./settings", () => ({
  /* getter 惰性取 Promise:mock 工厂只执行一次,直取会钉死首个实例。 */
  get settingsReady() {
    return h.state.ready.promise;
  },
  getSettingsState: () => h.state,
}));

vi.mock("./contributionLedger", () => ({
  makeAttributedCtx: (_ctx: PluginContext, plugin: Plugin) => {
    h.state.attributed.push(plugin.id);
    return _ctx;
  },
  pushCleanup: (id: string, done: () => void) => {
    h.state.cleanups.push([id, done]);
  },
  undoContributions: (id: string) => {
    h.state.undone.push(id);
  },
}));

vi.mock("./pluginQuarantine", () => ({
  isQuarantined: (id: string) => h.state.quarantined.has(id),
}));

import type { ContributionUndo } from "./contributionLedger";
import { PluginLifecycle } from "./pluginLifecycle";

const undo = {} as ContributionUndo;
const ctx = {} as PluginContext;
let lifecycle: PluginLifecycle;

/** 激活顺序记录(每个 activate 闭包共享)。 */
let order: string[];

function mkPlugin(
  id: string,
  opts?: { dependsOn?: string[]; activate?: () => void | (() => void) | Promise<void> },
): Plugin {
  return {
    id,
    meta: { name: id, abbr: id.slice(0, 2).toUpperCase(), desc: id, category: "feature" },
    dependsOn: opts?.dependsOn,
    activate: opts?.activate ?? (() => { order.push(id); }),
  };
}

beforeEach(() => {
  /* activateAll 把激活 Promise 记忆化到实例生命周期,逐测试换新实例才能各自激活。 */
  lifecycle = new PluginLifecycle(undo);
  h.state.settings.disabledPlugins = [];
  h.state.undone.length = 0;
  h.state.cleanups.length = 0;
  h.state.attributed.length = 0;
  h.state.quarantined.clear();
  h.rearmReady();
  order = [];
});

describe("activateAll 分波拓扑激活", () => {
  it("依赖先于被依赖者激活;清单乱序给出也不受影响", async () => {
    const a = mkPlugin("a");
    const b = mkPlugin("b", { dependsOn: ["a"] });
    const c = mkPlugin("c", { dependsOn: ["b"] });
    const d = mkPlugin("d");
    await lifecycle.activateAll([c, b, d, a], ctx);
    expect(order).toContain("d");
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    for (const id of ["a", "b", "c", "d"]) expect(lifecycle.isPluginActive(id)).toBe(true);
  });

  it("被拔插件不进激活循环,依赖被拔者的插件连带跳过且不误报依赖环", async () => {
    h.state.settings.disabledPlugins = ["off"];
    const off = mkPlugin("off");
    const child = mkPlugin("child", { dependsOn: ["off"] });
    const on = mkPlugin("on");
    await lifecycle.activateAll([off, child, on], ctx);
    expect(order).toEqual(["on"]);
    expect(lifecycle.isPluginActive("off")).toBe(false);
    expect(lifecycle.isPluginActive("child")).toBe(false);
  });

  it("settingsReady 未就绪不激活;就绪后按落盘值过滤", async () => {
    h.rearmReady(false);
    h.state.settings.disabledPlugins = ["off"];
    const off = mkPlugin("off");
    const on = mkPlugin("on");
    const pending = lifecycle.activateAll([off, on], ctx);
    await Promise.resolve();
    expect(order).toEqual([]);
    h.state.ready.resolve();
    await pending;
    expect(order).toEqual(["on"]);
    expect(lifecycle.isPluginActive("off")).toBe(false);
  });

  it("重复激活幂等:二次 activateAll 共享同一 Promise,不重跑 activate,首清单定格", async () => {
    const a = mkPlugin("a");
    const p1 = lifecycle.activateAll([a], ctx);
    const b = mkPlugin("b");
    const p2 = lifecycle.activateAll([a, b], ctx);
    expect(p2).toBe(p1);
    await p1;
    expect(order).toEqual(["a"]);
    expect(lifecycle.isPluginActive("b")).toBe(false);
    expect(lifecycle.listPluginStates().map((s) => s.plugin.id)).toEqual(["a"]);
  });

  it("并发双调用共享同一激活 Promise:首波挂起也不双跑 activate", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let runs = 0;
    const slow = mkPlugin("slow", {
      activate: () => {
        runs += 1;
        return gate;
      },
    });
    const p1 = lifecycle.activateAll([slow], ctx);
    const p2 = lifecycle.activateAll([slow], ctx);
    release();
    await Promise.all([p1, p2]);
    expect(runs).toBe(1);
  });
});

describe("activateAll 异常隔离", () => {
  it("activate 抛错原样上抛:失败插件零残留、贡献撤销、成功者不回滚、链在失败点中断", async () => {
    const cleanup = () => {};
    const a = mkPlugin("a", { activate: () => { order.push("a"); return cleanup; } });
    const boom = mkPlugin("boom", {
      activate: () => {
        order.push("boom");
        throw new Error("激活炸了");
      },
    });
    const c = mkPlugin("c");
    await expect(lifecycle.activateAll([a, boom, c], ctx)).rejects.toThrow("激活炸了");
    expect(order).toEqual(["a", "boom"]);
    expect(lifecycle.isPluginActive("a")).toBe(true);
    expect(lifecycle.isPluginActive("boom")).toBe(false);
    expect(lifecycle.isPluginActive("c")).toBe(false);
    expect(h.state.undone).toEqual(["boom"]);
    expect(h.state.cleanups).toEqual([["a", cleanup]]);
    expect(h.state.attributed).toEqual(["a", "boom"]);
  });
});

describe("activateLate 晚激活补充", () => {
  it("熔断插件拒绝晚激活,不执行 activate 也不残留", async () => {
    h.state.quarantined.add("q1");
    await expect(lifecycle.activateLate(mkPlugin("q1"), ctx)).rejects.toThrow("熔断");
    expect(order).toEqual([]);
    expect(lifecycle.isPluginActive("q1")).toBe(false);
    expect(h.state.undone).toEqual([]);
  });

  it("activate 抛错:同步占位回滚 + 贡献撤销 + 错误原样上抛", async () => {
    const bad = mkPlugin("bad", {
      activate: () => {
        throw new Error("晚激活炸了");
      },
    });
    await expect(lifecycle.activateLate(bad, ctx)).rejects.toThrow("晚激活炸了");
    expect(lifecycle.isPluginActive("bad")).toBe(false);
    expect(h.state.undone).toEqual(["bad"]);
  });
});

describe("revoke 熔断摘除", () => {
  it("移出激活表并撤销贡献;未激活 id 无副作用", async () => {
    await lifecycle.activateAll([mkPlugin("a"), mkPlugin("b")], ctx);
    lifecycle.revoke("a");
    expect(lifecycle.isPluginActive("a")).toBe(false);
    expect(lifecycle.isPluginActive("b")).toBe(true);
    expect(h.state.undone).toEqual(["a"]);
    lifecycle.revoke("ghost");
    expect(h.state.undone).toEqual(["a"]);
  });
});

describe("listPluginStates 插件市场数据源", () => {
  it("全量清单 × 启用态 join:被拔者也在列表,enabled=false", async () => {
    h.state.settings.disabledPlugins = ["off"];
    await lifecycle.activateAll([mkPlugin("on"), mkPlugin("off")], ctx);
    const states = lifecycle.listPluginStates();
    expect(states.map((s) => ({ id: s.plugin.id, enabled: s.enabled }))).toEqual([
      { id: "on", enabled: true },
      { id: "off", enabled: false },
    ]);
  });
});
