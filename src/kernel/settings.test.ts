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
      workspaceCollapsedMap: {},
      networkProxyEnabled: false,
      networkProxyUrl: "",
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

describe("Ask 提示音设置", () => {
  it("合法补丁合并生效", () => {
    settings.updateSettings({ askSoundEnabled: false, askSoundId: "bell" });
    const s = settings.getSettingsState().settings;
    expect(s.askSoundEnabled).toBe(false);
    expect(s.askSoundId).toBe("bell");
  });

  it("非法音效 id 回落 default,非布尔开关回落 true", async () => {
    settings.updateSettings({
      askSoundId: "junk" as never,
      askSoundEnabled: "yes" as never,
    });
    const s = settings.getSettingsState().settings;
    expect(s.askSoundId).toBe("default");
    expect(s.askSoundEnabled).toBe(true);
  });

  it("boot 加载:缺失字段补默认,非法字段清洗", async () => {
    ipcMock.configReadSettings.mockResolvedValue({
      askSoundId: "chime",
    });
    settings.ensureSettingsBooted();
    await waitLoaded();
    const s = settings.getSettingsState().settings;
    expect(s.askSoundEnabled).toBe(true);
    expect(s.askSoundId).toBe("chime");
  });
});

describe("结束提示音与后台提醒设置", () => {
  it("合法补丁合并生效", () => {
    settings.updateSettings({ turnEndSoundEnabled: false, turnEndSoundId: "ding" });
    const s = settings.getSettingsState().settings;
    expect(s.turnEndSoundEnabled).toBe(false);
    expect(s.turnEndSoundId).toBe("ding");
  });

  it("非法音效 id 回落 default,非布尔开关回落 true", () => {
    settings.updateSettings({
      turnEndSoundId: "junk" as never,
      turnEndSoundEnabled: 1 as never,
      backgroundNotify: "no" as never,
    });
    const s = settings.getSettingsState().settings;
    expect(s.turnEndSoundId).toBe("default");
    expect(s.turnEndSoundEnabled).toBe(true);
    expect(s.backgroundNotify).toBe(true);
  });

  it("boot 加载:缺失字段补默认,合法字段保留", async () => {
    ipcMock.configReadSettings.mockResolvedValue({
      turnEndSoundId: "bell",
      backgroundNotify: false,
    });
    settings.ensureSettingsBooted();
    await waitLoaded();
    const s = settings.getSettingsState().settings;
    expect(s.turnEndSoundEnabled).toBe(true);
    expect(s.turnEndSoundId).toBe("bell");
    expect(s.backgroundNotify).toBe(false);
  });
});

describe("网络代理设置", () => {
  it("合法补丁合并生效", () => {
    settings.updateSettings({
      networkProxyEnabled: true,
      networkProxyUrl: " http://127.0.0.1:7890 ",
    });
    const s = settings.getSettingsState().settings;
    expect(s.networkProxyEnabled).toBe(true);
    expect(s.networkProxyUrl).toBe("http://127.0.0.1:7890");
  });

  it("非布尔开关回落 false,非字符串地址回落空串", () => {
    settings.updateSettings({
      networkProxyEnabled: "yes" as never,
      networkProxyUrl: 7890 as never,
    });
    const s = settings.getSettingsState().settings;
    expect(s.networkProxyEnabled).toBe(false);
    expect(s.networkProxyUrl).toBe("");
  });

  it("boot 加载:地址 trim + 去控制字符,关闭态允许空地址保留", async () => {
    ipcMock.configReadSettings.mockResolvedValue({
      networkProxyEnabled: false,
      networkProxyUrl: "  socks5://127.0.0.1:1080\t",
    });
    settings.ensureSettingsBooted();
    await waitLoaded();
    const s = settings.getSettingsState().settings;
    expect(s.networkProxyEnabled).toBe(false);
    expect(s.networkProxyUrl).toBe("socks5://127.0.0.1:1080");
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
describe("resolveCliSessionQuota", () => {
  const REGISTERED = ["claude", "codex", "omp", "pi"] as const;

  it("全部未配置:均分总数(向下取整)", () => {
    const budget = { total: 20, perCli: {} };
    for (const id of REGISTERED) {
      expect(settings.resolveCliSessionQuota(budget, id, REGISTERED)).toBe(5);
    }
  });

  it("已配置 CLI 拿配额原值,未配置均分剩余", () => {
    const budget = { total: 20, perCli: { claude: 11 } };
    expect(settings.resolveCliSessionQuota(budget, "claude", REGISTERED)).toBe(11);
    expect(settings.resolveCliSessionQuota(budget, "codex", REGISTERED)).toBe(3);
  });

  it("显式 0 与未配置不同:0 是「不露出」,不参与均分", () => {
    const budget = { total: 9, perCli: { claude: 0 } };
    expect(settings.resolveCliSessionQuota(budget, "claude", REGISTERED)).toBe(0);
    expect(settings.resolveCliSessionQuota(budget, "codex", REGISTERED)).toBe(3);
  });

  it("剩余不足均分时落 0,不为负", () => {
    const budget = { total: 2, perCli: {} };
    expect(settings.resolveCliSessionQuota(budget, "claude", REGISTERED)).toBe(0);
  });

  it("全部已配置时未配置查询返回 0(无可分母)", () => {
    const budget = { total: 10, perCli: { claude: 4, codex: 3, omp: 2, pi: 1 } };
    expect(
      settings.resolveCliSessionQuota(budget, "ghost", REGISTERED),
    ).toBe(0);
  });

  it("已卸载 CLI 的残留 perCli key 不抬高占用(注册集外不计入已分配)", () => {
    /* 回归守卫:total 20,残留 uninstalled:14 若计入已分配,
       未配置组会被挤成 floor(6/4)=1 而非 floor(20/4)=5;
       与 budgetCommit.prunePerCli 的"残留不得抬高占用"不变式对齐 */
    const budget = { total: 20, perCli: { uninstalled: 14 } };
    expect(settings.resolveCliSessionQuota(budget, "claude", REGISTERED)).toBe(5);
    expect(settings.resolveCliSessionQuota(budget, "omp", REGISTERED)).toBe(5);
  });
});
