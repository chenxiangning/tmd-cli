/**
 * boardOverlayStore 看板覆盖层开关契约(插件局部单例状态):
 * - 初始关闭,读取零副作用;
 * - toggleBoardOverlay 翻转开关并广播订阅者;
 * - closeBoardOverlay:开启时关闭并广播,已关闭时零操作零广播;
 * - subscribeBoardOverlay 返回退订函数,退订后不再接收;多订阅者同帧全收。
 */
import { describe, expect, it, vi } from "vitest";

/* 动态 import 例外:被测模块是模块级单例,静态 import 会钉死共享实例,
 * 必须借 vi.resetModules + 逐测试动态 import 取全新实例(terminalLinks.test.ts 同款)。 */
async function freshStore() {
  vi.resetModules();
  return import("./boardOverlayStore");
}

describe("boardOverlayStore 覆盖层开关", () => {
  it("初始关闭,读取不产生副作用", async () => {
    const store = await freshStore();
    expect(store.boardOverlayOpen()).toBe(false);
  });

  it("toggle 翻转开关,订阅者按次收到最新态", async () => {
    const store = await freshStore();
    const seen: boolean[] = [];
    store.subscribeBoardOverlay(() => seen.push(store.boardOverlayOpen()));
    store.toggleBoardOverlay();
    store.toggleBoardOverlay();
    store.toggleBoardOverlay();
    expect(store.boardOverlayOpen()).toBe(true);
    expect(seen).toEqual([true, false, true]);
  });

  it("close 在开启时关闭并广播;已关闭时零操作零广播", async () => {
    const store = await freshStore();
    const notify = vi.fn();
    store.subscribeBoardOverlay(notify);
    /* 幂等面:已关闭再 close 不打扰订阅者。 */
    store.closeBoardOverlay();
    expect(notify).not.toHaveBeenCalled();
    store.toggleBoardOverlay();
    expect(notify).toHaveBeenCalledTimes(1);
    store.closeBoardOverlay();
    expect(store.boardOverlayOpen()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("退订后不再接收广播;多订阅者同帧全收", async () => {
    const store = await freshStore();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = store.subscribeBoardOverlay(a);
    store.subscribeBoardOverlay(b);
    unsubA();
    store.toggleBoardOverlay();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
