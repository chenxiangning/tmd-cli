/**
 * 终端 WebGL 渲染器 opt-in 装配契约测试(kernel/terminalWebglRenderer)。
 * 契约(2026-10-26 单真源化后):enabled=false → null;隐藏幕布(element 宽 0)
 * → 跳过返回 null 且不降级(不写 settings);装载失败/onContextLoss →
 * updateSettings 直写 terminalWebglRenderer=false,开关如实回落;cleanup 幂等。
 * node 环境:@xterm/addon-webgl 以桩模块替代(真 addon 需浏览器 WebGL 面);
 * 设置经真实 settings store 驱动(updateSettings 同步生效)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachWebglRenderer } from "./terminalWebglRenderer";
import { getSettingsState, updateSettings } from "./settings";

/* 桩 addon 模块:记录 dispose/onContextLoss 注册,可注入装载即抛。 */
const h = vi.hoisted(() => ({
  listeners: [] as Array<() => void>,
  disposed: 0,
  constructError: null as string | null,
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      if (h.constructError) throw new Error(h.constructError);
    }
    onContextLoss(cb: () => void) {
      h.listeners.push(cb);
    }
    dispose() {
      h.disposed++;
    }
  },
}));

/** 最小幕布替身:element 可控(0 宽模拟隐藏幕布)。 */
const makeTerm = (width = 640): Terminal =>
  ({
    element: { offsetWidth: width, clientWidth: width },
  }) as unknown as Terminal;

beforeEach(() => {
  h.listeners.length = 0;
  h.disposed = 0;
  h.constructError = null;
  updateSettings({ terminalWebglRenderer: false });
});

describe("terminalWebglRenderer", () => {
  it("enabled=false → attach 返回 null(不装载)", () => {
    expect(attachWebglRenderer(makeTerm(), false)).toBeNull();
    expect(getSettingsState().settings.terminalWebglRenderer).toBe(false);
  });

  it("隐藏幕布(element 宽 0)→ 跳过返回 null,不降级(不写 settings)", () => {
    expect(attachWebglRenderer(makeTerm(0), true)).toBeNull();
    expect(getSettingsState().settings.terminalWebglRenderer).toBe(false); /* 未被翻转 */
  });

  it("装载失败 → dispose + 直写 settings 关(开关如实回落),cleanup 幂等", async () => {
    h.constructError = "no webgl context";
    const cleanup = attachWebglRenderer(makeTerm(), true);
    if (typeof cleanup !== "function") throw new Error("装载失败也应返回 cleanup(异步降级)");
    await vi.waitFor(() =>
      expect(getSettingsState().settings.terminalWebglRenderer).toBe(false),
    );
    expect(() => cleanup()).not.toThrow(); /* 幂等 */
  });

  it("onContextLoss → dispose + 直写 settings 关", async () => {
    const cleanup = attachWebglRenderer(makeTerm(), true);
    if (typeof cleanup !== "function") throw new Error("装载成功应返回 cleanup");
    await vi.waitFor(() => expect(h.listeners.length).toBe(1));
    h.listeners[0]();
    expect(h.disposed).toBe(1);
    expect(getSettingsState().settings.terminalWebglRenderer).toBe(false);
    cleanup();
    expect(h.disposed).toBe(1); /* unload 幂等:dispose 只一次 */
  });
});
