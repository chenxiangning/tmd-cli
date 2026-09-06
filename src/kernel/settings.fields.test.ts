/**
 * 设置字段级清洗契约测试(提示音/后台提醒/网络代理/会话配额/Memory)——
 * 自 settings.test.ts 拆出(文件规模铁则收紧至 300 行)。
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

/** 等待异步 load() 落地。 */
async function waitLoaded(): Promise<void> {
  await vi.waitFor(() => {
    expect(settings.getSettingsState().loaded).toBe(true);
  });
}
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

describe("Memory 设置(memory-coordinator)", () => {
  it("合法补丁合并生效", () => {
    settings.updateSettings({
      memoryEnabled: false,
      memoryCapsuleMode: "auto",
      memoryDbPath: "/tmp/fresh/mc/context.db",
    });
    const s = settings.getSettingsState().settings;
    expect(s.memoryEnabled).toBe(false);
    expect(s.memoryCapsuleMode).toBe("auto");
    expect(s.memoryDbPath).toBe("/tmp/fresh/mc/context.db");
  });

  it("非法枚举/非字符串路径回落默认", () => {
    settings.updateSettings({
      memoryCapsuleMode: "sometimes" as never,
      memoryDbPath: 42 as never,
      memoryEnabled: "yes" as never,
    });
    const s = settings.getSettingsState().settings;
    expect(s.memoryCapsuleMode).toBe("manual");
    expect(s.memoryDbPath).toBe("");
    expect(s.memoryEnabled).toBe(true);
  });

  it("自动沉淀开关与沉淀模型/规则:透传、截断、回落", () => {
    const cur = () => settings.getSettingsState().settings;
    settings.updateSettings({ memoryAutoDistill: true, memoryDistillModel: "kimi-code/k3", memoryDistillRules: "记住数据库决定" });
    expect(cur().memoryAutoDistill).toBe(true);
    expect(cur().memoryDistillModel).toBe("kimi-code/k3");
    expect(cur().memoryDistillRules).toBe("记住数据库决定");
    settings.updateSettings({ memoryDistillModel: "x".repeat(300), memoryDistillRules: "y".repeat(600) });
    expect(cur().memoryDistillModel.length).toBe(200);
    expect(cur().memoryDistillRules.length).toBe(500);
    settings.updateSettings({ memoryAutoDistill: "on" as never, memoryDistillModel: 9 as never, memoryDistillRules: null as never });
    expect(cur().memoryAutoDistill).toBe(false);
    expect(cur().memoryDistillModel).toBe("");
    expect(cur().memoryDistillRules).toBe("");
  });

  it("超长路径截断到 500 字符", () => {
    settings.updateSettings({ memoryDbPath: "x".repeat(600) });
    expect(settings.getSettingsState().settings.memoryDbPath.length).toBe(500);
  });
});
