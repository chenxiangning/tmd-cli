/**
 * 贡献记账契约 —— 注册透传 + 撤销清表 + events 门控 + cleanup 并轨。
 * 真注册表(settingsRegistry/tabs/marketPanel/shortcuts/filePanel)落地断言,
 * HostRegistry 三通道以 spy undo 注入(装配环由 hostRegistry 侧测试覆盖)。
 */
import { describe, expect, it } from "vitest";
import {
  grantsOf,
  makeAttributedCtx,
  pushCleanup,
  undoContributions,
  type ContributionUndo,
} from "./contributionLedger";
import { getCommands, registerCommand } from "./shortcuts";
import { getTabContent } from "./tabs";
import type { CliProfile } from "./cli";
import type { ComponentType } from "react";
import { getMarketPanel } from "./marketPanel";
import { getFilePanels } from "./filePanel";
import { registerSettingsSection } from "./settingsRegistry";
import { registerFilePanel } from "./filePanel";
import { registerTabContent } from "./tabs";
import { registerMarketPanel } from "./marketPanel";
import type { MountPoint, Plugin, PluginContext } from "./plugin";

const Fake: ComponentType = () => null;
const eventsStub = {
  on: () => () => {},
  emit: () => {},
};
function fakeCtx(): PluginContext {
  return {
    events: eventsStub,
    registerCliProfile: () => {},
    contribute: () => {},
    registerSettingsSection,
    registerFilePanel,
    registerTabContent,
    registerMarketPanel,
    registerSidebarAction: () => {},
    registerFileVisual: () => {},
    registerCommand,
    registerHomePanel: () => {},
    registerCliConfig: () => {},
  };
}
function fakePlugin(id: string): Plugin {
  return {
    id,
    meta: { name: id, abbr: "TT", desc: "", category: "feature" },
    activate: () => {},
  };
}
function spyUndo(calls: string[]): ContributionUndo {
  return {
    removeCliProfile: (id) => calls.push(`profile:${id}`),
    removeMount: (point: MountPoint) => calls.push(`mount:${point}`),
    removeSidebarActionById: (id) => calls.push(`sidebar:${id}`),
  };
}

describe("contributionLedger 贡献记账", () => {
  it("注册透传真注册表;撤销清表(命令/tab 内容/市场面板/右栏面板)", () => {
    const undo = spyUndo([]);
    const ctx = makeAttributedCtx(fakeCtx(), fakePlugin("p1"), undo);
    ctx.registerTabContent({ kind: "p1.kind", component: Fake });
    ctx.registerCommand({ id: "p1.cmd", title: "x", run: () => {} });
    ctx.registerMarketPanel({ pluginId: "p1", icon: Fake, title: "", component: Fake });
    ctx.registerFilePanel({ id: "p1.panel", label: "x", icon: Fake, component: Fake });
    expect(getTabContent("p1.kind")).toBeDefined();
    expect(getCommands().some((c) => c.id === "p1.cmd")).toBe(true);
    expect(getMarketPanel("p1")).toBeDefined();
    expect(getFilePanels().some((p) => p.id === "p1.panel")).toBe(true);

    undoContributions("p1");
    expect(getTabContent("p1.kind")).toBeUndefined();
    expect(getCommands().some((c) => c.id === "p1.cmd")).toBe(false);
    expect(getMarketPanel("p1")).toBeUndefined();
    expect(getFilePanels().some((p) => p.id === "p1.panel")).toBe(false);
  });

  it("events 未授权访问即抛;内置(null grants)不受限", () => {
    const local = makeAttributedCtx(fakeCtx(), { ...fakePlugin("p2"), permissions: [] }, spyUndo([]));
    expect(() => local.events.on("x", () => {})).toThrow(/events/);
    expect(() => local.events.emit("x", {})).toThrow(/events/);
    const builtin = makeAttributedCtx(fakeCtx(), fakePlugin("p3"), spyUndo([]));
    expect(typeof builtin.events.on).toBe("function");
  });

  it("grantsOf:无 permissions 字段 = 不受限(null);空数组 = 纯 UI 零授权", () => {
    expect(grantsOf(fakePlugin("x"))).toBeNull();
    const grants = grantsOf({ ...fakePlugin("y"), permissions: [] });
    expect(grants?.size).toBe(0);
    expect(grantsOf({ ...fakePlugin("z"), permissions: ["ipc.fs.read"] })?.has("ipc.fs.read")).toBe(true);
  });

  it("activate 返回的 cleanup 并入账本,撤销时执行", () => {
    makeAttributedCtx(fakeCtx(), fakePlugin("p4"), spyUndo([]));
    let cleaned = false;
    pushCleanup("p4", () => {
      cleaned = true;
    });
    expect(cleaned).toBe(false);
    undoContributions("p4");
    expect(cleaned).toBe(true);
  });

  it("HostRegistry 三通道撤销经 spy 透传(cli profile/挂点/侧栏动作)", () => {
    const calls: string[] = [];
    const ctx = makeAttributedCtx(fakeCtx(), fakePlugin("p5"), spyUndo(calls));
    ctx.registerCliProfile({ id: "p5-engine" } as CliProfile);
    ctx.contribute("header.right", { component: Fake });
    ctx.registerSidebarAction({ id: "p5.act", label: "x", icon: Fake, onSelect: () => {} });
    undoContributions("p5");
    expect(calls).toEqual(["sidebar:p5.act", "mount:header.right", "profile:p5-engine"]);
  });
});
