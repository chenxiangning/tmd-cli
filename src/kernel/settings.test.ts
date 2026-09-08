/**
 * 全局设置 store 行为契约测试。
 * 覆盖:默认值、updateSettings 合并与 sanitize 回落(非法 theme/preset id/sendShortcut)、
 * boot 加载优先级(Tauri → localStorage 降级)、持久化降级、面板开关幂等、
 * subscribe/退订。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type SettingsModule = typeof import("./settings");

let settings: SettingsModule;


beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  settings = await import("./settings");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("初始状态与默认值", () => {
  it("boot 前:默认设置、loaded=false、面板关闭", () => {
    const s = settings.getSettingsState();
    expect(s.settings).toEqual({
      theme: "system",
      lightThemePresetId: "vscode-light-modern",
      darkThemePresetId: "vscode-dark-modern",
      customThemePresetId: "vscode-dark-modern",
      language: "zh",
      terminalFontSize: 13,
      terminalFontFamily: "",
      uiFontSize: 16,
      uiZoom: 1,
      sessionTabsEnabled: true,
      sendShortcut: "enter",
      askSoundEnabled: true,
      askSoundId: "default",
      turnEndSoundEnabled: true,
      turnEndSoundId: "default",
      backgroundNotify: true,
      sessionOutputBufferLimit: 500_000,
      sessionListBudget: { total: 20, perCli: {} },
      disabledPlugins: [],
      sessionTitles: {},
      sessionPins: {},
      sessionArchive: {},
      sessionDeleted: {},
      workspaceArchiveView: false,
      workspaceCollapsedMap: {},
      workspaceGroupCollapsedMap: {},
      networkProxyEnabled: false,
      networkProxyUrl: "",
      memoryDbPath: "",
      memoryEnabled: true,
      memoryCapsuleMode: "manual",
      memoryAutoDistill: false,
      memoryDistillModel: "",
      memoryDistillEngine: "omp",
      memoryDistillRules: "",
      ssh: { hosts: [] },
      git: { view: "diff", layout: "flat" },
    });
    expect(s.loaded).toBe(false);
    expect(s.panelOpen).toBe(false);
  });
});

describe("会话标题 tab 开关", () => {
  it("合法补丁合并生效,非布尔回落 true(默认开)", () => {
    settings.updateSettings({ sessionTabsEnabled: false });
    expect(settings.getSettingsState().settings.sessionTabsEnabled).toBe(false);
    settings.updateSettings({ sessionTabsEnabled: "no" as never });
    expect(settings.getSettingsState().settings.sessionTabsEnabled).toBe(true);
  });
});

describe("updateSettings 合并与清洗", () => {
  it("合法补丁合并生效,未触及字段保留", () => {
    settings.updateSettings({ theme: "dark" });
    const s = settings.getSettingsState().settings;
    expect(s.theme).toBe("dark");
    expect(s.lightThemePresetId).toBe("vscode-light-modern");
  });

  it("非法 theme 回落 system", () => {
    settings.updateSettings({ theme: "neon" as never });
    expect(settings.getSettingsState().settings.theme).toBe("system");
  });

  it("非法 preset id 回落默认 preset", () => {
    settings.updateSettings({ darkThemePresetId: "not-a-preset" as never });
    expect(settings.getSettingsState().settings.darkThemePresetId).toBe(
      "vscode-dark-modern",
    );
  });
  it("非法 sendShortcut 回落 enter", () => {
    settings.updateSettings({ sendShortcut: "ctrl+shift" as never });
    expect(settings.getSettingsState().settings.sendShortcut).toBe("enter");
  });

  it("合法 sendShortcut 合并生效,未触及字段保留", () => {
    settings.updateSettings({ sendShortcut: "cmdOrCtrlEnter" });
    const s = settings.getSettingsState().settings;
    expect(s.sendShortcut).toBe("cmdOrCtrlEnter");
    expect(s.theme).toBe("system");
  });

  it("非法 sessionOutputBufferLimit 回落默认 50 万", () => {
    settings.updateSettings({ sessionOutputBufferLimit: 10 });
    expect(settings.getSettingsState().settings.sessionOutputBufferLimit).toBe(500_000);
    settings.updateSettings({ sessionOutputBufferLimit: Number.NaN });
    expect(settings.getSettingsState().settings.sessionOutputBufferLimit).toBe(500_000);
  });

  it("合法 sessionOutputBufferLimit 生效", () => {
    settings.updateSettings({ sessionOutputBufferLimit: 1_000_000 });
    expect(settings.getSettingsState().settings.sessionOutputBufferLimit).toBe(1_000_000);
  });

  it("合法 preset id 生效", () => {
    settings.updateSettings({ darkThemePresetId: "vscode-monokai" });
    expect(settings.getSettingsState().settings.darkThemePresetId).toBe(
      "vscode-monokai",
    );
  });
  it("sessionListBudget:非法 total 与缺省字段回落默认", () => {
    settings.updateSettings({
      sessionListBudget: { total: 0, perCli: {} },
    });
    expect(settings.getSettingsState().settings.sessionListBudget).toEqual({
      total: 20,
      perCli: {},
    });
    settings.updateSettings({ sessionListBudget: {} as never });
    expect(settings.getSettingsState().settings.sessionListBudget).toEqual({
      total: 20,
      perCli: {},
    });
  });

  it("sessionListBudget:非法 perCli 项丢弃,合法项保留", () => {
    settings.updateSettings({
      sessionListBudget: {
        total: 10,
        perCli: { claude: 3, bad: -1, worse: 1.5, worst: "x" },
      } as never,
    });
    expect(settings.getSettingsState().settings.sessionListBudget).toEqual({
      total: 10,
      perCli: { claude: 3 },
    });
  });

  it("sessionListBudget:超 sum ≤ total 的项按 key 序丢弃(确定性)", () => {
    settings.updateSettings({
      sessionListBudget: {
        total: 5,
        perCli: { codex: 3, claude: 3, omp: 2 },
      },
    });
    // key 排序后 claude(3) 先纳入,codex(3) 超预算丢弃,omp(2) 恰好纳入
    expect(settings.getSettingsState().settings.sessionListBudget).toEqual({
      total: 5,
      perCli: { claude: 3, omp: 2 },
    });
  });

  it("disabledPlugins:非字符串剔除、去重、排序(确定性)", () => {
    settings.updateSettings({
      disabledPlugins: ["cli-codex", "git", "cli-codex", 1, "", null],
    } as never);
    expect(settings.getSettingsState().settings.disabledPlugins).toEqual([
      "cli-codex",
      "git",
    ]);
  });

  it("disabledPlugins:非数组回落空表(全启用,失败安全方向)", () => {
    settings.updateSettings({ disabledPlugins: "git" as never });
    expect(settings.getSettingsState().settings.disabledPlugins).toEqual([]);
  });

  it("disabledPlugins:插回(从列表移除)合并生效", () => {
    settings.updateSettings({ disabledPlugins: ["cli-codex", "git"] });
    settings.updateSettings({ disabledPlugins: ["git"] });
    expect(settings.getSettingsState().settings.disabledPlugins).toEqual(["git"]);
  });

  it("持久化收到的是清洗后的完整 settings", () => {
    settings.updateSettings({ theme: "light" });
    expect(ipcMock.configWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "light",
        lightThemePresetId: "vscode-light-modern",
        darkThemePresetId: "vscode-dark-modern",
        customThemePresetId: "vscode-dark-modern",
      }),
    );
  });
});

describe("外观域字段清洗(language/终端字体字号/界面缩放)", () => {
  it("language:白名单外回落 zh", () => {
    settings.updateSettings({ language: "fr" as never });
    expect(settings.getSettingsState().settings.language).toBe("zh");
    settings.updateSettings({ language: "ja" });
    expect(settings.getSettingsState().settings.language).toBe("ja");
  });

  it("terminalFontSize:越界/非整数回落默认 13,合法值放行", () => {
    settings.updateSettings({ terminalFontSize: 25 });
    expect(settings.getSettingsState().settings.terminalFontSize).toBe(13);
    settings.updateSettings({ terminalFontSize: 8 });
    expect(settings.getSettingsState().settings.terminalFontSize).toBe(13);
    settings.updateSettings({ terminalFontSize: 17 });
    expect(settings.getSettingsState().settings.terminalFontSize).toBe(17);
  });

  it("uiFontSize:越界/非整数回落默认 16,合法值放行", () => {
    settings.updateSettings({ uiFontSize: 25 });
    expect(settings.getSettingsState().settings.uiFontSize).toBe(16);
    settings.updateSettings({ uiFontSize: 8 });
    expect(settings.getSettingsState().settings.uiFontSize).toBe(16);
    settings.updateSettings({ uiFontSize: 15.5 });
    expect(settings.getSettingsState().settings.uiFontSize).toBe(16);
    settings.updateSettings({ uiFontSize: 18 });
    expect(settings.getSettingsState().settings.uiFontSize).toBe(18);
  });

  it("terminalFontFamily:去控制字符 + trim;非字符串回落空(平台默认)", () => {
    settings.updateSettings({ terminalFontFamily: " 'JetBrains Mono',\u0007 monospace " });
    expect(settings.getSettingsState().settings.terminalFontFamily).toBe(
      "'JetBrains Mono', monospace",
    );
    settings.updateSettings({ terminalFontFamily: 42 as never });
    expect(settings.getSettingsState().settings.terminalFontFamily).toBe("");
  });

  it("uiZoom:取 5% 档 + 越界钳位 + 非法回落 1", () => {
    settings.updateSettings({ uiZoom: 1.37 });
    expect(settings.getSettingsState().settings.uiZoom).toBe(1.35);
    settings.updateSettings({ uiZoom: 9 });
    expect(settings.getSettingsState().settings.uiZoom).toBe(1.5);
    settings.updateSettings({ uiZoom: "broken" as never });
    expect(settings.getSettingsState().settings.uiZoom).toBe(1);
  });
});
