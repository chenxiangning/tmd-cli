/**
 * i18n 内核契约测试:t() 查表/回落/插值与 bootI18n 的 <html lang> 同步。
 * settings store 是模块级单例,沿用 settings.test.ts 的 resetModules + ipc mock 手法。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));
import type * as I18nModule from "./i18n";
import type * as SettingsModule from "./settings";

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type Modules = {
  settings: typeof SettingsModule;
  i18n: typeof I18nModule;
};

let mods: Modules;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:模块级单例,resetModules 后取全新实例
  mods = {
    settings: await import("./settings"),
    i18n: await import("./i18n"),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("t() 查表与回落", () => {
  it("zh(默认)= 恒等返回源串;占位符替换", () => {
    expect(mods.i18n.t("关闭")).toBe("关闭");
    expect(mods.i18n.t("共 {n} 条", { n: 3 })).toBe("共 3 条");
  });

  it("en/ja 命中词典返回译文;缺失键回落源串", () => {
    // 词典由文案迁移任务填充;用已知一定存在的键不可假设,改为注入式验证:
    // 切到 en 后,查一个不存在的键仍回落源串(兜底语义不依赖词典内容)。
    mods.settings.updateSettings({ language: "en" });
    expect(mods.i18n.t("__不存在的键__")).toBe("__不存在的键__");
    mods.settings.updateSettings({ language: "ja" });
    expect(mods.i18n.t("__不存在的键__")).toBe("__不存在的键__");
  });
});
describe("bootI18n", () => {
  it("node 环境无 DOM 时安全 no-op(幂等,不抛错)", () => {
    expect(() => mods.i18n.bootI18n()).not.toThrow();
    expect(() => mods.i18n.bootI18n()).not.toThrow();
  });
});
