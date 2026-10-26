/**
 * 终端 WebGL 渲染器 opt-in 装配契约测试(kernel/terminalWebglRenderer)。
 * 覆盖:设置关 → null;降级记忆(localStorage)→ 不再自动装;
 * clearWebglDegradedMemory 清记忆;node 无 WebGL:装载失败安全降级
 * (记忆 + 不抛,cleanup 幂等)。
 * node 环境:localStorage 用内存 stub;设置经真实 settings store 驱动
 * (updateSettings 同步生效),每用例显式回置目标键。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  WEBGL_DEGRADED_KEY,
  attachWebglRenderer,
  clearWebglDegradedMemory,
} from "./terminalWebglRenderer";
import { updateSettings } from "./settings";

let backing: Map<string, string>;

/** 最小幕布替身:loadAddon 可按需抛(模拟无 WebGL 上下文);探针路径不触达。 */
const makeTerm = (loadAddonError?: string): Terminal =>
  ({
    rows: 4,
    element: null,
    loadAddon: () => {
      if (loadAddonError) throw new Error(loadAddonError);
    },
  }) as unknown as Terminal;

beforeEach(() => {
  backing = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  });
  updateSettings({ terminalWebglRenderer: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminalWebglRenderer", () => {
  it("设置关 → attach 返回 null(不装载)", () => {
    expect(attachWebglRenderer(makeTerm())).toBeNull();
  });

  it("降级记忆后 attach 返回 null;清记忆后恢复装载", () => {
    updateSettings({ terminalWebglRenderer: true });
    backing.set(WEBGL_DEGRADED_KEY, "1");
    expect(attachWebglRenderer(makeTerm())).toBeNull(); /* 记忆后不再自动装 */
    clearWebglDegradedMemory();
    expect(backing.has(WEBGL_DEGRADED_KEY)).toBe(false);
    expect(typeof attachWebglRenderer(makeTerm())).toBe("function"); /* 用户重开:重试 */
  });

  it("node 无 WebGL:装载失败安全降级(记忆 + 不抛),cleanup 幂等", async () => {
    updateSettings({ terminalWebglRenderer: true });
    const cleanup = attachWebglRenderer(makeTerm("no webgl context"));
    if (typeof cleanup !== "function") throw new Error("装载失败也应返回 cleanup(异步降级)");
    await vi.waitFor(() => expect(backing.get(WEBGL_DEGRADED_KEY)).toBe("1")); /* 等 import 链降级落地 */
    expect(attachWebglRenderer(makeTerm())).toBeNull(); /* 此后不再自动装 */
    expect(() => cleanup()).not.toThrow(); /* 幂等 */
  });
});
