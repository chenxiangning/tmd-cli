/**
 * E-02 rail 默认钉住治理契约 —— 四插件 registerFilePanel 声明面:
 * 新装默认只钉 memory-files(AI 配置统一入口);memory/skill-hub/mcp-hub/marks
 * 默认不钉;marks 不再声明 pinOnce(移除自动补钉);老用户 persisted 清单不变
 * 由 kernel filePanel 契约测试守护,此处只钉插件声明。
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { FilePanelContribution } from "@kernel/filePanel";
import type { Plugin, PluginContext } from "@kernel/plugin";

/* 重面板/后台装配模块打桩(只测注册声明,不测本体)。 */
vi.mock("@plugins/memory-coordinator/panel/MemoryPanel", () => ({ MemoryPanel: () => null }));
vi.mock("@plugins/memory-coordinator/panel/MemoryFilesPanel", () => ({ MemoryFilesPanel: () => null }));
vi.mock("@plugins/memory-coordinator/capsule/MemoryCapsule", () => ({ MemoryCapsule: () => null }));
vi.mock("@plugins/memory-coordinator/phase2/autoDistill", () => ({ attachAutoDistill: () => () => {} }));
vi.mock("@plugins/memory-coordinator/wiki/wikiHook", () => ({ attachWikiStore: () => () => {} }));
vi.mock("@plugins/skill-hub/SkillHubPanel", () => ({ SkillHubPanel: () => null }));
vi.mock("@plugins/skill-hub/SkillHubTab", () => ({ SkillHubTab: () => null }));
vi.mock("@plugins/mcp-hub/McpHubPanel", () => ({ McpHubPanel: () => null }));
vi.mock("@plugins/mcp-hub/McpHubTab", () => ({ McpHubTab: () => null }));
vi.mock("@plugins/mcp-hub/hubStore", () => ({ refreshHub: () => {} }));
vi.mock("@plugins/marks/panel", () => ({ MarksPanel: () => null }));
vi.mock("@plugins/marks/chips", () => ({ MarksComposerChips: () => null }));
vi.mock("@plugins/marks/terminalLink", () => ({ marksLinkProvider: {} }));
vi.mock("@plugins/marks/editorExtension", () => ({ marksEditorExtension: {} }));
vi.mock("@plugins/marks/sendTransform", () => ({ marksSendTransform: () => "", undoLastSendTransform: () => "" }));
vi.mock("@plugins/marks/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@plugins/marks/store")>();
  return { ...mod, loadAllMarks: () => Promise.resolve(), stagedMarks: () => [], marksSnapshot: () => ({ byCwd: {} }), subscribeMarks: () => () => {} };
});

import { memoryCoordinatorPlugin } from "@plugins/memory-coordinator";
import { skillHubPlugin } from "@plugins/skill-hub";
import { mcpHubPlugin } from "@plugins/mcp-hub";
import { marksPlugin } from "@plugins/marks";

/** 收集 registerFilePanel 贡献的 ctx;其余注册面一律 no-op(events 返回退订)。 */
function collectingCtx(panels: FilePanelContribution[]): PluginContext {
  const events = { on: () => () => {}, off: () => {}, emit: () => {} };
  return new Proxy({ events }, {
    get(target, prop) {
      if (prop === "registerFilePanel") return (p: FilePanelContribution) => void panels.push(p);
      if (prop in target) return (target as Record<PropertyKey, unknown>)[prop];
      return () => {};
    },
  }) as unknown as PluginContext;
}

const panels: FilePanelContribution[] = [];

beforeAll(() => {
  /* 每个插件只 activate 一次(注册表重复 id 会抛错)。 */
  void (memoryCoordinatorPlugin as Plugin).activate(collectingCtx(panels));
  skillHubPlugin.activate(collectingCtx(panels));
  mcpHubPlugin.activate(collectingCtx(panels));
  marksPlugin.activate(collectingCtx(panels));
});

describe("E-02 默认钉住声明", () => {
  it("memory/skill-hub/mcp-hub/marks 显式 pinnedByDefault:false", () => {
    const byId = Object.fromEntries(panels.map((p) => [p.id, p]));
    expect(byId.memory?.pinnedByDefault).toBe(false);
    expect(byId["skill-hub"]?.pinnedByDefault).toBe(false);
    expect(byId["mcp-hub"]?.pinnedByDefault).toBe(false);
    expect(byId.marks?.pinnedByDefault).toBe(false);
  });

  it("memory-files 仍默认钉(AI 配置统一入口);marks 不再有 pinOnce 自动补钉", () => {
    const byId = Object.fromEntries(panels.map((p) => [p.id, p]));
    expect(byId["memory-files"]).toBeDefined();
    expect(byId["memory-files"]?.pinnedByDefault ?? true).toBe(true);
    expect(byId.marks?.pinOnce ?? false).toBe(false);
    expect(byId.memory?.pinOnce ?? false).toBe(false);
    expect(byId["skill-hub"]?.pinOnce ?? false).toBe(false);
    expect(byId["mcp-hub"]?.pinOnce ?? false).toBe(false);
  });

  it("中央管理 tab 联动不因取钉丢失(centerTab 声明原样)", () => {
    const byId = Object.fromEntries(panels.map((p) => [p.id, p]));
    expect(typeof byId["skill-hub"]?.centerTab?.open).toBe("function");
    expect(typeof byId["mcp-hub"]?.centerTab?.open).toBe("function");
  });
});
