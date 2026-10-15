/**
 * iconDecor 契约(bootIconDecor):
 * 启动即按 settings.iconDecor 遍历白名单 id —— 有 color 写 --icon-decor-<id>,
 * 无 color 抹掉同名变量(不留旧色残留);blink 项按白名单顺序空格拼接写
 * <html data-icon-blink>,无 blink 项时删除该属性;设置变更经订阅重放同规则;
 * boot 幂等(重复调用不重复订阅)。
 * document 以最小桩替代,settings 以可控桩替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ICON_DECOR_IDS } from "./settingsIconDecor";

const settingsMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const settings = { iconDecor: {} as Record<string, { color?: string; blink?: boolean }> };
  return {
    settings,
    emit: () => listeners.forEach((fn) => fn()),
    listenerCount: () => listeners.size,
    reset: () => {
      listeners.clear();
    },
    getSettingsState: () => ({ settings }),
    subscribeSettings: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

/** 全量 decor:白名单全键齐全(Record<IconDecorId, _> 是全键契约),partial 只覆盖显式项。 */
function fullDecor(partial: Record<string, { color?: string; blink?: boolean }>) {
  const out: Record<string, { color?: string; blink?: boolean }> = {};
  for (const id of ICON_DECOR_IDS) out[id] = partial[id] ?? {};
  return out;
}

vi.mock("./settings", async () => {
  /* vi.mock 工厂被提升到顶层 import 之前执行,静态导入在此不可见,只能 await import;
   * 白名单与 settingsIconDecor.ts 真表同源(域文件),桩不自带列表防漂移 */
  const { ICON_DECOR_IDS } = await import("./settingsIconDecor");
  return {
    getSettingsState: settingsMock.getSettingsState,
    subscribeSettings: settingsMock.subscribeSettings,
    ICON_DECOR_IDS,
  };
});

type IconDecorModule = typeof import("./iconDecor");

const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
const root = { style, dataset: {} as Record<string, string | undefined> };

beforeEach(() => {
  vi.resetModules();
  settingsMock.reset();
  settingsMock.settings.iconDecor = fullDecor({});
  style.setProperty.mockClear();
  style.removeProperty.mockClear();
  for (const key of Object.keys(root.dataset)) delete root.dataset[key];
  vi.stubGlobal("document", { documentElement: root });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot(): Promise<IconDecorModule> {
  return import("./iconDecor");
}

describe("bootIconDecor", () => {
  it("有 color 的 id 写变量,无 color 的 id 抹变量;白名单全覆盖", async () => {
    settingsMock.settings.iconDecor = fullDecor({
      newchat: { color: "#112233" },
      "panel-git": { color: "#445566" },
    });
    const mod = await boot();
    mod.bootIconDecor();

    expect(style.setProperty).toHaveBeenCalledWith("--icon-decor-newchat", "#112233");
    expect(style.setProperty).toHaveBeenCalledWith("--icon-decor-panel-git", "#445566");
    /* 其余 id 必须被抹(出厂色语义 = 无变量),不留上次残留 */
    expect(style.removeProperty).toHaveBeenCalledWith("--icon-decor-ssh-panel");
    expect(style.removeProperty).toHaveBeenCalledWith("--icon-decor-panel-checkpoints");
    const touched = new Set([
      ...style.setProperty.mock.calls.map((c) => c[0]),
      ...style.removeProperty.mock.calls.map((c) => c[0]),
    ]);
    expect(touched.size).toBe(ICON_DECOR_IDS.length);
  });

  it("blink 项按白名单顺序空格拼接写 data-icon-blink", async () => {
    settingsMock.settings.iconDecor = fullDecor({
      "panel-git": { blink: true },
      newchat: { blink: true },
    });
    const mod = await boot();
    mod.bootIconDecor();
    expect(root.dataset.iconBlink).toBe("newchat panel-git");
  });

  it("无 blink 项时不残留 data-icon-blink 属性", async () => {
    root.dataset.iconBlink = "stale";
    const mod = await boot();
    mod.bootIconDecor();
    expect(root.dataset.iconBlink).toBeUndefined();
  });

  it("设置变更经订阅重放:新 color 生效、blink 撤销后属性删除", async () => {
    settingsMock.settings.iconDecor = fullDecor({ newchat: { blink: true, color: "#111111" } });
    const mod = await boot();
    mod.bootIconDecor();

    settingsMock.settings.iconDecor = fullDecor({ "panel-files": { color: "#222222" } });
    settingsMock.emit();

    expect(style.setProperty).toHaveBeenLastCalledWith("--icon-decor-panel-files", "#222222");
    expect(style.removeProperty).toHaveBeenCalledWith("--icon-decor-newchat");
    expect(root.dataset.iconBlink).toBeUndefined();
  });

  it("boot 幂等:重复调用不重复订阅", async () => {
    const mod = await boot();
    mod.bootIconDecor();
    mod.bootIconDecor();
    expect(settingsMock.listenerCount()).toBe(1);
  });
});
