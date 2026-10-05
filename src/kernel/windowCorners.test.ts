/**
 * windowCorners 契约(bootWindowCorners):
 * 启动初查 windowSquareCorners,为真时置位 html[data-window-square];
 * 窗口几何变化(onWindowGeometryChange)重判并跟随清除;boot 幂等 ——
 * 重复调用不重复初查、不重复订阅。ipc 以可控桩替代,document 以最小桩替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    square: false,
    windowSquareCorners: vi.fn(() => Promise.resolve(ipcMock.square)),
    onWindowGeometryChange: vi.fn((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    emitGeometry: () => listeners.forEach((fn) => fn()),
    listenerCount: () => listeners.size,
    reset: () => {
      listeners.clear();
      ipcMock.square = false;
      ipcMock.windowSquareCorners.mockClear();
      ipcMock.onWindowGeometryChange.mockClear();
    },
  };
});

vi.mock("./ipc", () => ({
  windowSquareCorners: ipcMock.windowSquareCorners,
  onWindowGeometryChange: ipcMock.onWindowGeometryChange,
}));

const attrs = new Set<string>();

beforeEach(() => {
  vi.resetModules();
  ipcMock.reset();
  attrs.clear();
  vi.stubGlobal("document", {
    documentElement: {
      toggleAttribute: (name: string, force?: boolean) => {
        if (force) attrs.add(name);
        else attrs.delete(name);
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bootWindowCorners", () => {
  it("初查为方角态时置位 data-window-square", async () => {
    ipcMock.square = true;
    const mod = await import("./windowCorners");
    mod.bootWindowCorners();
    await vi.waitFor(() => expect(attrs.has("data-window-square")).toBe(true));
  });

  it("几何变化重判:最大化 → 还原后标记清除", async () => {
    ipcMock.square = true;
    const mod = await import("./windowCorners");
    mod.bootWindowCorners();
    await vi.waitFor(() => expect(attrs.has("data-window-square")).toBe(true));

    ipcMock.square = false;
    ipcMock.emitGeometry();
    await vi.waitFor(() => expect(attrs.has("data-window-square")).toBe(false));
  });

  it("boot 幂等:不重复初查、不重复订阅", async () => {
    const mod = await import("./windowCorners");
    mod.bootWindowCorners();
    mod.bootWindowCorners();
    expect(ipcMock.windowSquareCorners).toHaveBeenCalledTimes(1);
    expect(ipcMock.listenerCount()).toBe(1);
  });
});
