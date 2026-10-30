/**
 * attachTerminalStream 隐藏幕布合帧写入 —— 自 terminalReplay.test.ts 拆出
 * (文件规模铁则)。mock 脚手架与本件同构:可控 host emitter、无输出缓冲。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadProgress } from "./terminalReplay";

const hoisted = vi.hoisted(() => ({
  listeners: new Map<string, Array<(t: string) => void>>(),
}));

vi.mock("@kernel/host", () => ({
  ptyLiveTopic: (id: string) => `pty://out/${id}`,
  host: {
    events: {
      on: (topic: string, cb: (t: string) => void) => {
        const arr = hoisted.listeners.get(topic) ?? [];
        arr.push(cb);
        hoisted.listeners.set(topic, arr);
        return () =>
          hoisted.listeners.set(
            topic,
            (hoisted.listeners.get(topic) ?? []).filter((f) => f !== cb),
          );
      },
    },
    getOutputBuffer: () => null,
    getCliSessionId: () => undefined,
    observeReplayTail: () => undefined,
    restoreDiskTail: () => undefined,
    appendOutput: () => undefined,
  },
}));

vi.mock("./diskReplay", () => ({ consumeDiskTail: () => null }));

import { attachTerminalStream, settleTerminalJump } from "./terminalReplay";

function fakeTerm() {
  const writes: string[] = [];
  return {
    writes,
    write(data: string, cb?: () => void) {
      writes.push(data);
      queueMicrotask(() => cb?.());
    },
  };
}

function emit(id: string, text: string) {
  for (const cb of hoisted.listeners.get(`pty://out/${id}`) ?? []) cb(text);
}

const gate = {
  arm: () => undefined,
  release: () => undefined,
  blocked: () => false,
};

describe("attachTerminalStream 隐藏幕布合帧写入", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    hoisted.listeners.clear();
  });

  it("隐藏期实时字节攒 250ms 合并写,激活即冲刷,切回无缺字节", () => {
    const term = fakeTerm();
    let hidden = true;
    const flushes: Array<() => void> = [];
    const off = attachTerminalStream(term, "s9", gate, (_p: LoadProgress) => undefined, undefined, {
      shouldDefer: () => hidden,
      bindFlush: (fn) => {
        if (fn) flushes.push(fn);
      },
    });

    emit("s9", "tick-1");
    emit("s9", "tick-2");
    expect(term.writes).toEqual([]); // 隐藏期不直写
    vi.advanceTimersByTime(250);
    expect(term.writes).toEqual(["tick-1tick-2"]); // 250ms 合一帧

    // 激活:冲刷残留攒帧;此后走前台 rAF 合帧(16ms 一帧,2026-10-26 起)
    hidden = false;
    emit("s9", "tick-3");
    expect(term.writes).toEqual(["tick-1tick-2"]); // rAF 帧未到,暂在攒批
    vi.advanceTimersByTime(16);
    expect(term.writes).toEqual(["tick-1tick-2", "tick-3"]);
    expect(flushes).toHaveLength(1);
    flushes[0]();
    expect(term.writes).toEqual(["tick-1tick-2", "tick-3"]); // 无攒帧时空冲刷无副作用
    off();
  });

  it("卸载解绑冲刷入口并清攒帧计时器(字节真源在 outputBuffers)", () => {
    const term = fakeTerm();
    let hidden = true;
    let bound: (() => void) | "unbound" = "unbound";
    const off = attachTerminalStream(term, "s9", gate, (_p: LoadProgress) => undefined, undefined, {
      shouldDefer: () => hidden,
      bindFlush: (fn) => {
        bound = fn ?? "unbound";
      },
    });
    emit("s9", "stuck-pending");
    off();
    expect(bound).toBe("unbound"); // 卸载即解绑,激活冲刷不得打向死幕布
    vi.advanceTimersByTime(1_000);
    expect(term.writes).toEqual([]); // 计时器已清,攒帧随卸载丢弃
  });

  it("冲刷入口返回本次冲入字符数,空冲刷返回 0(卸载快照水位扣减)", () => {
    const term = fakeTerm();
    const bound: { flush: (() => number) | null } = { flush: null };
    const off = attachTerminalStream(term, "s10", gate, (_p: LoadProgress) => undefined, undefined, {
      shouldDefer: () => true,
      bindFlush: (fn) => {
        bound.flush = fn as (() => number) | null;
      },
    });
    emit("s10", "abc");
    emit("s10", "def");
    expect(term.writes).toEqual([]); /* 攒帧未到 250ms 不落笔 */
    expect(bound.flush?.()).toBe(6);
    expect(term.writes).toEqual(["abcdef"]);
    expect(bound.flush?.()).toBe(0); /* 已清空,再冲无残留 */
    off();
  });
});

describe("settleTerminalJump 卸载取消", () => {
  it("历史页等待期卸载:拒绝跳转且不再写幕布", async () => {
    const history = Promise.withResolvers<void>();
    const disposal = Promise.withResolvers<void>();
    let disposed = false;
    let flushes = 0;
    const term = fakeTerm();
    const pending = settleTerminalJump(term, {
      pager: Promise.resolve(), stream: Promise.resolve(), history: () => history.promise,
      flush: () => { flushes += 1; }, disposed: () => disposed, disposal: disposal.promise,
    });
    disposed = true;
    disposal.resolve();
    await expect(pending).rejects.toThrow("terminal disposed");
    expect(term.writes).toEqual([]);
    expect(flushes).toBe(1);
  });

  it("xterm 写队列等待期卸载:迟到回调也不得改判成功", async () => {
    const disposal = Promise.withResolvers<void>();
    let disposed = false;
    let writeCallback: (() => void) | undefined;
    const term = { write: (_data: string, cb?: () => void) => { writeCallback = cb; } };
    const pending = settleTerminalJump(term, {
      pager: Promise.resolve(), stream: Promise.resolve(), history: () => Promise.resolve(),
      flush: () => undefined, disposed: () => disposed, disposal: disposal.promise,
    });
    while (!writeCallback) await Promise.resolve();
    disposed = true;
    disposal.resolve();
    writeCallback();
    await expect(pending).rejects.toThrow("terminal disposed");
  });
});
