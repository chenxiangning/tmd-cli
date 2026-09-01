/**
 * 全局设置 store 行为契约测试。
 * 覆盖:默认值、updateSettings 合并与 sanitize 回落(非法 theme/preset id)、
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

/** 极简 localStorage stub(node 环境无 Web Storage)。 */
function stubLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

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

/** 等待异步 load() 落地。 */
async function waitLoaded(): Promise<void> {
  await vi.waitFor(() => {
    expect(settings.getSettingsState().loaded).toBe(true);
  });
}

describe("初始状态与默认值", () => {
  it("boot 前:默认设置、loaded=false、面板关闭", () => {
    const s = settings.getSettingsState();
    expect(s.settings).toEqual({
      theme: "system",
      lightThemePresetId: "vscode-light-modern",
      darkThemePresetId: "vscode-dark-modern",
      customThemePresetId: "vscode-dark-modern",
    });
    expect(s.loaded).toBe(false);
    expect(s.panelOpen).toBe(false);
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

  it("合法 preset id 生效", () => {
    settings.updateSettings({ darkThemePresetId: "vscode-monokai" });
    expect(settings.getSettingsState().settings.darkThemePresetId).toBe(
      "vscode-monokai",
    );
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

describe("boot 加载契约", () => {
  it("Tauri 返回部分字段:合法字段采用,缺失字段补默认", async () => {
    ipcMock.configReadSettings.mockResolvedValue({ theme: "dark" });
    settings.ensureSettingsBooted();
    await waitLoaded();
    const s = settings.getSettingsState().settings;
    expect(s.theme).toBe("dark");
    expect(s.lightThemePresetId).toBe("vscode-light-modern");
  });

  it("Tauri 返回 null:全默认且 loaded=true", async () => {
    settings.ensureSettingsBooted();
    await waitLoaded();
    expect(settings.getSettingsState().settings.theme).toBe("system");
  });

  it("Tauri 不可用:降级 localStorage 读取", async () => {
    ipcMock.configReadSettings.mockRejectedValue(new Error("no tauri"));
    stubLocalStorage({
      "tmd.settings.v1": JSON.stringify({ theme: "custom" }),
    });
    settings.ensureSettingsBooted();
    await waitLoaded();
    expect(settings.getSettingsState().settings.theme).toBe("custom");
  });

  it("Tauri 与 localStorage 均不可用:全默认兜底", async () => {
    ipcMock.configReadSettings.mockRejectedValue(new Error("no tauri"));
    stubLocalStorage();
    settings.ensureSettingsBooted();
    await waitLoaded();
    expect(settings.getSettingsState().settings.theme).toBe("system");
  });

  it("幂等:重复 boot 只读一次", async () => {
    settings.ensureSettingsBooted();
    settings.ensureSettingsBooted();
    await waitLoaded();
    expect(ipcMock.configReadSettings).toHaveBeenCalledTimes(1);
  });
});

describe("持久化降级", () => {
  it("Tauri 写失败时降级写 localStorage", async () => {
    ipcMock.configWriteSettings.mockRejectedValue(new Error("no tauri"));
    const store = stubLocalStorage();
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => {
      expect(store.get("tmd.settings.v1")).toBeDefined();
    });
    expect(JSON.parse(store.get("tmd.settings.v1")!)).toMatchObject({
      theme: "dark",
    });
  });
});

describe("设置面板开关", () => {
  it("open/close 切换 panelOpen", () => {
    settings.openSettingsPanel();
    expect(settings.getSettingsState().panelOpen).toBe(true);
    settings.closeSettingsPanel();
    expect(settings.getSettingsState().panelOpen).toBe(false);
  });

  it("重复 open/close 幂等,不重复通知订阅者", () => {
    const fn = vi.fn();
    const unsub = settings.subscribeSettings(fn);
    settings.openSettingsPanel();
    settings.openSettingsPanel();
    expect(fn).toHaveBeenCalledTimes(1);
    settings.closeSettingsPanel();
    settings.closeSettingsPanel();
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });
});

describe("subscribeSettings", () => {
  it("退订后不再收到通知", () => {
    const fn = vi.fn();
    const unsub = settings.subscribeSettings(fn);
    settings.updateSettings({ theme: "dark" });
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    settings.updateSettings({ theme: "light" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
