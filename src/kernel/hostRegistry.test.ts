/**
 * 被测契约:src/kernel/hostRegistry.ts(插件注册表组合件)
 * 1. CLI profile 注册/查询:注册后可查、notify 触发、重复 id 抛错;
 * 2. fetchQuota 声明与 kernel/quota provider 成对登记/逆除;removeCliProfile 幂等;
 * 3. 挂点贡献按 order 稳定排序;未知挂点查询回落空数组;按引用逆除、未知引用静默;
 * 4. 侧栏动作注册 → sidebarActions 注册表 + sidebar.<id> 无键位命令镜像,
 *    命令缺省锚点 = (8, 视口底-8);removeSidebarActionById 成对逆除且幂等;
 * 5. 熔断接线:达到崩溃阈值 → 撤销插件贡献并触发外壳重渲染;
 * 6. 撤销通道注入:账本经 undo 回调逆除时走本件同一移除路径(成对清理 quota);
 * 7. lifecycle 委托:activateLate 成功后 notify;市场数据源转发。
 *
 * 手法:vi.resetModules + 动态 import 隔离模块级单例(刻意测试模块加载边界,
 * 静态 import 无法在用例间重置 quota/sidebarActions/shortcuts 单例态,故豁免)。
 * quota/sidebarActions/shortcuts/pluginQuarantine 用真模块;pluginLifecycle 用同形
 * 假件顶替(其真实编排自有一套行为,本文件只验注册表侧的委托与接线)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const life = vi.hoisted(() => ({
  undo: null as object | null,
  revoke: vi.fn(),
  activateAll: vi.fn(),
  activateLate: vi.fn(),
  listPluginStates: vi.fn(),
  isPluginActive: vi.fn(),
}));

vi.mock("./pluginLifecycle", () => ({
  PluginLifecycle: class {
    revoke = life.revoke;
    activateAll = life.activateAll;
    activateLate = life.activateLate;
    listPluginStates = life.listPluginStates;
    isPluginActive = life.isPluginActive;
    constructor(undo: object) {
      life.undo = undo;
    }
  },
}));

import type { CliProfile } from "./cli";
import type { HostRegistry } from "./hostRegistry";
import type { MountContribution } from "./plugin";

// resetModules 后必须与被测件取同一模块副本(单例态在真模块里),统一动态 import。
let getCommands: typeof import("./shortcuts").getCommands;
let defaultPinnedActionIds: typeof import("./sidebarActions").defaultPinnedActionIds;
let getQuotaProvider: typeof import("./quota").getQuotaProvider;
let recordPluginCrash: typeof import("./pluginQuarantine").recordPluginCrash;
let QUARANTINE_CRASH_THRESHOLD: number;

const profile = (id: string, extra: Partial<CliProfile> = {}): CliProfile =>
  ({ id, name: id, ...extra }) as CliProfile;

const mount = (order?: number): MountContribution => ({
  component: () => null,
  order,
});

describe("HostRegistry", () => {
  let HostRegistryCtor: typeof HostRegistry;
  let notify: () => void;
  let registry: HostRegistry;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./hostRegistry");
    HostRegistryCtor = mod.HostRegistry;
    ({ getCommands } = await import("./shortcuts"));
    ({ defaultPinnedActionIds } = await import("./sidebarActions"));
    ({ getQuotaProvider } = await import("./quota"));
    ({ QUARANTINE_CRASH_THRESHOLD, recordPluginCrash } = await import(
      "./pluginQuarantine"
    ));
    vi.stubGlobal("window", { innerHeight: 800 });
    notify = vi.fn<() => void>();
    registry = new HostRegistryCtor(notify);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("CLI profile 注册表", () => {
    it("注册后可按 id 查询,列表为快照,并触发外壳重渲染通知", () => {
      registry.registerCliProfile(profile("claude"));
      expect(registry.getCliProfile("claude")?.id).toBe("claude");
      expect(registry.getCliProfile("omp")).toBeUndefined();
      expect(registry.getCliProfiles().map((p) => p.id)).toEqual(["claude"]);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it("重复 id 注册抛错且不覆盖原 profile", () => {
      registry.registerCliProfile(profile("claude", { name: "旧名" }));
      expect(() => registry.registerCliProfile(profile("claude"))).toThrow(
        /重复注册/,
      );
      expect(registry.getCliProfile("claude")?.name).toBe("旧名");
    });

    it("fetchQuota 声明随注册登记进 quota 注册表,逆除时成对清理", () => {
      const fetch = vi.fn();
      registry.registerCliProfile(profile("claude", { fetchQuota: fetch }));
      expect(getQuotaProvider("claude")?.fetch).toBe(fetch);

      registry.removeCliProfile("claude");
      expect(getQuotaProvider("claude")).toBeNull();
      expect(registry.getCliProfile("claude")).toBeUndefined();
      expect(notify).toHaveBeenCalledTimes(2);

      // 未声明 fetchQuota 的 profile 不产生 provider
      registry.registerCliProfile(profile("omp"));
      expect(getQuotaProvider("omp")).toBeNull();
    });

    it("removeCliProfile 对未知 id 静默幂等(不触发通知)", () => {
      registry.removeCliProfile("不存在的id");
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("挂点贡献", () => {
    it("按 order 升序排列,缺省 order 视为 0", () => {
      registry.contribute("overlay", mount(5));
      registry.contribute("overlay", mount(1));
      registry.contribute("overlay", mount());
      expect(registry.getMount("overlay").map((x) => x.order ?? 0)).toEqual([
        0, 1, 5,
      ]);
    });

    it("未知挂点查询回落空数组,且非共享引用(外部改动不进注册表)", () => {
      const empty = registry.getMount("nope" as never);
      expect(empty).toEqual([]);
      empty.push(mount());
      expect(registry.getMount("nope" as never)).toEqual([]);
    });

    it("按注册时的贡献对象引用逆除;未知引用静默不通知", () => {
      const a = mount(1);
      const b = mount(2);
      registry.contribute("overlay", a);
      registry.contribute("overlay", b);
      registry.removeMount("overlay", b);
      expect(registry.getMount("overlay")).toEqual([a]);
      registry.removeMount("overlay", b); // 幂等
      expect(registry.getMount("overlay")).toHaveLength(1);
      expect(notify).toHaveBeenCalledTimes(3);
    });
  });

  describe("侧栏动作镜像", () => {
    const action = {
      id: "proxy",
      label: "代理",
      order: 3,
      defaultPinned: true,
      /* 图标组件不参与本组断言,以 never 占位 */
      onSelect: vi.fn<() => void>(),
      icon: null as never,
    };

    it("注册进侧栏动作表并镜像为 sidebar.<id> 无键位命令", () => {
      new HostRegistryCtor(notify).registerSidebarAction(action);
      expect(defaultPinnedActionIds()).toContain("proxy");
      const cmd = getCommands().find((c) => c.id === "sidebar.proxy");
      expect(cmd?.title).toBe("代理");
      expect(cmd?.keybinding).toBeUndefined();
    });

    it("镜像命令缺省锚点 = 视口左下角 (8, innerHeight-8)", () => {
      new HostRegistryCtor(notify).registerSidebarAction(action);
      getCommands()
        .find((c) => c.id === "sidebar.proxy")!
        .run();
      expect(action.onSelect).toHaveBeenCalledWith({ x: 8, y: 792 });
    });

    it("removeSidebarActionById 成对逆除动作与命令,重复调用幂等", () => {
      const r = new HostRegistryCtor(notify);
      r.registerSidebarAction(action);
      r.removeSidebarActionById("proxy");
      expect(defaultPinnedActionIds()).not.toContain("proxy");
      expect(getCommands().some((c) => c.id === "sidebar.proxy")).toBe(false);
      expect(() => r.removeSidebarActionById("proxy")).not.toThrow();
    });
  });

  describe("熔断与撤销通道接线", () => {
    it("崩溃达阈值触发熔断:撤销插件贡献并通知外壳", () => {
      for (let i = 0; i < QUARANTINE_CRASH_THRESHOLD; i++) {
        recordPluginCrash("bad-plugin", "渲染崩溃");
      }
      expect(life.revoke).toHaveBeenCalledWith("bad-plugin");
      expect(notify).toHaveBeenCalled();
      // 已熔断后重复上报不再触发
      expect(recordPluginCrash("bad-plugin", "again")).toBe(false);
    });

    it("贡献账本经注入的 undo 回调逆除时,走本件移除路径(成对清 quota)", () => {
      const fetch = vi.fn();
      const c = mount(1);
      registry.registerCliProfile(profile("claude", { fetchQuota: fetch }));
      registry.contribute("overlay", c);
      const undo = life.undo as HostRegistry;
      undo.removeCliProfile("claude");
      undo.removeMount("overlay", c);
      undo.removeSidebarActionById("ghost");
      expect(getQuotaProvider("claude")).toBeNull();
      expect(registry.getMount("overlay")).toEqual([]);
    });
  });

  describe("lifecycle 委托", () => {
    it("activateLate 委托 lifecycle,成功后触发通知;市场查询转发", async () => {
      life.activateLate.mockResolvedValue(undefined);
      life.listPluginStates.mockReturnValue([]);
      life.isPluginActive.mockReturnValue(false);
      const ctx = {};
      await registry.activateLate({ id: "x" } as never, ctx as never);
      expect(life.activateLate).toHaveBeenCalledWith({ id: "x" }, ctx);
      expect(notify).toHaveBeenCalledTimes(1);
      registry.activateAll([], ctx as never);
      expect(life.activateAll).toHaveBeenCalledWith([], ctx);
      expect(registry.listPluginStates()).toEqual([]);
      expect(registry.isPluginActive("x")).toBe(false);
    });
  });
});
