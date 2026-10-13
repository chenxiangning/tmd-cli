/**
 * 设置字段级清洗契约测试 · 续(workbench 文档默认视图)——
 * 自 settings.fields.test.ts 拆出守 300 行铁则;harness 与母文件一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type SettingsModule = typeof import("./settings");

let settings: SettingsModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  settings = await import("./settings");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("工作台文档默认视图", () => {
  it("合法补丁合并生效", () => {
    settings.updateSettings({ workbenchDocDefaultMode: "edit" });
    expect(settings.getSettingsState().settings.workbenchDocDefaultMode).toBe("edit");
    settings.updateSettings({ workbenchDocDefaultMode: "preview" });
    expect(settings.getSettingsState().settings.workbenchDocDefaultMode).toBe("preview");
  });

  it("非法值回落 preview", () => {
    settings.updateSettings({ workbenchDocDefaultMode: "junk" as never });
    expect(settings.getSettingsState().settings.workbenchDocDefaultMode).toBe("preview");
  });

  it("boot 加载:缺失字段补默认,合法存量保留", async () => {
    ipcMock.configReadSettings.mockResolvedValue({ workbenchDocDefaultMode: "edit" });
    settings.ensureSettingsBooted();
    await vi.waitFor(() => {
      expect(settings.getSettingsState().loaded).toBe(true);
    });
    expect(settings.getSettingsState().settings.workbenchDocDefaultMode).toBe("edit");
  });
});

describe("工作台默认会话引擎与每引擎模型", () => {
  it("引擎 id 自由串存取;模型表只留串值", () => {
    settings.updateSettings({ workbenchDefaultEngine: "claude", workbenchEngineModels: { claude: "claude-opus-4-6", omp: "gpt-5.2", bad: 3 as never } });
    const s = settings.getSettingsState().settings;
    expect(s.workbenchDefaultEngine).toBe("claude");
    expect(s.workbenchEngineModels).toEqual({ claude: "claude-opus-4-6", omp: "gpt-5.2" });
    settings.updateSettings({ workbenchDefaultEngine: "" });
    expect(settings.getSettingsState().settings.workbenchDefaultEngine).toBe("");
  });

  it("非法类型回落默认", () => {
    settings.updateSettings({ workbenchDefaultEngine: 7 as never, workbenchEngineModels: "junk" as never });
    const s = settings.getSettingsState().settings;
    expect(s.workbenchDefaultEngine).toBe("");
    expect(s.workbenchEngineModels).toEqual({});
  });
});
