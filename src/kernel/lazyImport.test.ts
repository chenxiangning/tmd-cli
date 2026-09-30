import { describe, expect, it, vi } from "vitest";
import { retryImport } from "./lazyImport";

/** 计时器全走假钟:重试节奏不真等;14 次退避总计约 95s,推进 120s 覆盖。 */
vi.useFakeTimers();

function flush() {
  return vi.advanceTimersByTimeAsync(120_000);
}

describe("retryImport(dev 504 竞态护栏)", () => {
  it("首两次被拒后第三次成功 —— 优化期 504 场景终获模块", async () => {
    let calls = 0;
    const load = retryImport(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error("504 Outdated Optimize Dep"));
      return Promise.resolve({ ok: true });
    });
    const p = load();
    await flush();
    await expect(p).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("成功 memo:二次调用不重跑 loader", async () => {
    let calls = 0;
    const load = retryImport(() => {
      calls += 1;
      return Promise.resolve(calls);
    });
    await expect(load()).resolves.toBe(1);
    await expect(load()).resolves.toBe(1);
    expect(calls).toBe(1);
  });

  it("持续失败到上限后 rejection 不缓存:终败后重开拿到全新链", async () => {
    let calls = 0;
    const load = retryImport(() => {
      calls += 1;
      return Promise.reject(new Error("dead"));
    });
    const first = load();
    first.catch(() => undefined); /* 即挂空 catch:终败 rejection 与 rejects 断言挂接之间不留未处理窗,否则 Node 发 unhandledRejection 被 vitest 收红(时序性) */
    await flush();
    await expect(first).rejects.toThrow("dead");
    const doneAt = calls;
    const second = load();
    second.catch(() => undefined);
    await flush();
    await expect(second).rejects.toThrow("dead");
    expect(calls).toBe(doneAt * 2);
  });
});
