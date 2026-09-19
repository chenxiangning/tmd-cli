/**
 * createSubscribable 契约:
 * snapshot —— 初始即 initial 引用;两次变更之间引用稳定;
 * commit —— 换快照引用并通知全部订阅者(订阅顺序多播);
 * replace —— 只换快照引用不通知;
 * notify —— 只通知不换快照;
 * subscribe —— 返回退订函数,退订后不再收到通知,退订不影响其他订阅者;
 * useStore —— useSyncExternalStore 直通(订阅走同一 listeners 集),客户端渲染面
 *   在 node 环境无 jsdom 不可实例化,本文件不覆盖(其行为由 snapshot/subscribe 契约背书)。
 */
import { describe, expect, it, vi } from "vitest";
import { createSubscribable } from "./subscribable";

describe("snapshot 引用稳定性", () => {
  it("初始 snapshot 就是 initial 引用", () => {
    const initial = { n: 1 };
    const store = createSubscribable(initial);
    expect(store.snapshot).toBe(initial);
  });

  it("replace 后引用换新;未再变更前保持同一引用", () => {
    const store = createSubscribable({ n: 1 });
    const next = { n: 2 };
    store.replace(next);
    expect(store.snapshot).toBe(next);
    /* 未变更期间反复读取必须是同一引用(getSnapshot 新建 = useSyncExternalStore 死循环) */
    expect(store.snapshot).toBe(next);
  });

  it("commit 后引用换新并保持稳定", () => {
    const store = createSubscribable({ n: 1 });
    const next = { n: 2 };
    store.commit(next);
    expect(store.snapshot).toBe(next);
    expect(store.snapshot).toBe(next);
  });
});

describe("commit / notify / replace 的通知语义", () => {
  it("commit 通知全部订阅者,按订阅顺序多播", () => {
    const store = createSubscribable({ n: 0 });
    const calls: string[] = [];
    store.subscribe(() => calls.push("a"));
    store.subscribe(() => calls.push("b"));
    store.commit({ n: 1 });
    expect(calls).toEqual(["a", "b"]);
  });

  it("replace 只换引用不通知", () => {
    const store = createSubscribable({ n: 0 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.replace({ n: 2 });
    expect(fn).not.toHaveBeenCalled();
    expect(store.snapshot).toEqual({ n: 2 });
  });

  it("notify 只通知不换快照", () => {
    const initial = { n: 0 };
    const store = createSubscribable(initial);
    const fn = vi.fn();
    store.subscribe(fn);
    store.notify();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.snapshot).toBe(initial);
  });

  it("同一订阅函数只注册一次(Set 语义),一次变更只收到一次通知", () => {
    const store = createSubscribable(0);
    const fn = vi.fn();
    store.subscribe(fn);
    store.subscribe(fn);
    store.commit(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe 退订", () => {
  it("退订后不再收到通知", () => {
    const store = createSubscribable(0);
    const fn = vi.fn();
    const unsubscribe = store.subscribe(fn);
    unsubscribe();
    store.commit(1);
    store.notify();
    expect(fn).not.toHaveBeenCalled();
  });

  it("退订一个订阅者不影响其余订阅者", () => {
    const store = createSubscribable(0);
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = store.subscribe(a);
    store.subscribe(b);
    unsubA();
    store.commit(1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("退订函数可重复调用,幂等不抛错", () => {
    const store = createSubscribable(0);
    const unsubscribe = store.subscribe(vi.fn());
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
