/**
 * uiZoom 契约(bootUiZoom):
 * 启动即按 settings.uiZoom 走原生通道 ipc.setWebviewZoom;Tauri 通道失败
 * (Promise reject 或同步抛)回落 #root 的 CSS zoom;#root 不存在时回落静默;
 * 原生通道成功时不动 CSS zoom;设置变更经订阅重放;boot 幂等(不重复订阅)。
 * settings 与 ipc 以可控桩替代,document 以最小桩替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const settings = { uiZoom: 1 };
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
const ipcMock = vi.hoisted(() => ({ setWebviewZoom: vi.fn() }));

vi.mock("./settings", () => ({
  getSettingsState: settingsMock.getSettingsState,
  subscribeSettings: settingsMock.subscribeSettings,
}));
vi.mock("./ipc", () => ({ setWebviewZoom: ipcMock.setWebviewZoom }));

const rootEl = { style: { zoom: "" as string } };

beforeEach(() => {
  vi.resetModules();
  settingsMock.reset();
  settingsMock.settings.uiZoom = 1;
  ipcMock.setWebviewZoom.mockReset();
  ipcMock.setWebviewZoom.mockResolvedValue(undefined);
  rootEl.style.zoom = "";
  vi.stubGlobal("document", { getElementById: (id: string) => (id === "root" ? rootEl : null) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const load = (): Promise<typeof import("./uiZoom")> => import("./uiZoom");

describe("bootUiZoom", () => {
  it("启动即按当前 uiZoom 调原生缩放通道,成功时不落 CSS zoom", async () => {
    settingsMock.settings.uiZoom = 1.25;
    const mod = await load();
    mod.bootUiZoom();
    expect(ipcMock.setWebviewZoom).toHaveBeenCalledWith(1.25);
    expect(rootEl.style.zoom).toBe("");
  });

  it("原生通道 reject 回落 #root CSS zoom", async () => {
    ipcMock.setWebviewZoom.mockRejectedValue(new Error("no webview"));
    settingsMock.settings.uiZoom = 1.5;
    const mod = await load();
    mod.bootUiZoom();
    await vi.waitFor(() => expect(rootEl.style.zoom).toBe("1.5"));
  });

  it("原生通道同步抛同样回落;#root 缺失时静默不抛", async () => {
    ipcMock.setWebviewZoom.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const mod = await load();
    settingsMock.settings.uiZoom = 0.8;
    expect(() => mod.bootUiZoom()).not.toThrow();
    expect(rootEl.style.zoom).toBe("0.8");

    /* 无 #root 的环境(如测试桩)回落路径不得抛;booted 守卫 → 需全新模块实例 */
    vi.resetModules();
    vi.stubGlobal("document", { getElementById: () => null });
    const mod2 = await import("./uiZoom");
    expect(() => mod2.bootUiZoom()).not.toThrow();
  });

  it("设置变更经订阅重放;boot 幂等不重复订阅", async () => {
    const mod = await load();
    mod.bootUiZoom();
    expect(ipcMock.setWebviewZoom).toHaveBeenLastCalledWith(1);

    settingsMock.settings.uiZoom = 1.25;
    settingsMock.emit();
    expect(ipcMock.setWebviewZoom).toHaveBeenLastCalledWith(1.25);

    settingsMock.settings.uiZoom = 2;
    mod.bootUiZoom();
    expect(settingsMock.listenerCount()).toBe(1);
  });
});
