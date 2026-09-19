/**
 * uiFontSize 契约(bootUiFontSize):
 * 启动即把 settings.uiFontSize 写为 html 根字号(documentElement.style.fontSize);
 * 设置变更经订阅重放新字号;boot 幂等 —— 重复调用不重复订阅,也不重放旧值。
 * settings 以可控桩替代,document 以最小桩替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const settings = { uiFontSize: 16 };
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

vi.mock("./settings", () => ({
  getSettingsState: settingsMock.getSettingsState,
  subscribeSettings: settingsMock.subscribeSettings,
}));

const rootStyle = { fontSize: "" as string };

beforeEach(() => {
  vi.resetModules();
  settingsMock.reset();
  settingsMock.settings.uiFontSize = 16;
  rootStyle.fontSize = "";
  vi.stubGlobal("document", { documentElement: { style: rootStyle } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bootUiFontSize", () => {
  it("启动即应用当前 uiFontSize 为根字号", async () => {
    settingsMock.settings.uiFontSize = 18;
    const mod = await import("./uiFontSize");
    mod.bootUiFontSize();
    expect(rootStyle.fontSize).toBe("18px");
  });

  it("设置变更经订阅重放新字号", async () => {
    const mod = await import("./uiFontSize");
    mod.bootUiFontSize();
    expect(rootStyle.fontSize).toBe("16px");

    settingsMock.settings.uiFontSize = 13;
    settingsMock.emit();
    expect(rootStyle.fontSize).toBe("13px");
  });

  it("boot 幂等:重复调用不重复订阅、不重放未广播的设置值", async () => {
    const mod = await import("./uiFontSize");
    mod.bootUiFontSize();

    /* 设置已改但尚未广播:第二次 boot 不应重放(booted 守卫) */
    settingsMock.settings.uiFontSize = 20;
    mod.bootUiFontSize();
    expect(rootStyle.fontSize).toBe("16px");
    expect(settingsMock.listenerCount()).toBe(1);
  });
});
