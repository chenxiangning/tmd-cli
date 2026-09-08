/**
 * 图标装饰(iconDecor)清洗契约测试 —— 独立成文件(settings.fields.test.ts 已近 300 行铁则)。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例
 * (动态 import 属测试例外:被测对象是模块级单例,静态导入拿不到重置后的实例)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "./settings";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

/** 被测单例的测试可见面(结构化,避免内联 typeof import 注解)。 */
let settings: {
  getSettingsState: () => { loaded: boolean; settings: AppSettings };
  updateSettings: (patch: Partial<AppSettings>) => void;
  ensureSettingsBooted: () => void;
};

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  settings = (await import("./settings")) as unknown as typeof settings;
});

describe("图标装饰设置", () => {
  it("出厂默认:newchat 呼吸开,其余全默认,8 键齐全", () => {
    const d = settings.getSettingsState().settings.iconDecor;
    expect(d.newchat).toEqual({ blink: true });
    expect(d.eye).toEqual({});
    expect(Object.keys(d)).toHaveLength(8);
  });

  it("合法补丁合并生效:色与闪烁互相独立,其余键不动", () => {
    settings.updateSettings({
      iconDecor: {
        ...settings.getSettingsState().settings.iconDecor,
        eye: { color: "#FF8C3C", blink: true },
      },
    });
    const d = settings.getSettingsState().settings.iconDecor;
    expect(d.eye).toEqual({ color: "#ff8c3c", blink: true });
    expect(d.newchat).toEqual({ blink: true });
    expect(d["panel-git"]).toEqual({});
  });

  it("非法色丢弃,白名单外键剔除,blink 非布尔回落出厂", () => {
    const raw = {
      ...settings.getSettingsState().settings.iconDecor,
      newchat: { blink: "yes" },
      eye: { color: "red" },
      "panel-git": { color: "#00FF00", blink: false },
      junk: { color: "#000000" },
    } as Record<string, unknown>;
    settings.updateSettings({
      iconDecor: raw as unknown as AppSettings["iconDecor"],
    });
    const d = settings.getSettingsState().settings.iconDecor;
    expect(d.newchat).toEqual({ blink: true });
    expect(d.eye).toEqual({});
    expect(d["panel-git"]).toEqual({ color: "#00ff00", blink: false });
    expect((d as unknown as Record<string, unknown>).junk).toBeUndefined();
  });

  it("显式关闭 newchat 呼吸后保持关闭,重启(重清洗)不复活", () => {
    ipcMock.configReadSettings.mockResolvedValue({
      iconDecor: { newchat: { blink: false } },
    });
    settings.ensureSettingsBooted();
    return vi.waitFor(() => {
      expect(settings.getSettingsState().loaded).toBe(true);
      expect(settings.getSettingsState().settings.iconDecor.newchat).toEqual({ blink: false });
    });
  });
});
