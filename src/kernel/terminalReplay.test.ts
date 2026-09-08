import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadProgress } from "./terminalReplay";

/** host mock:可控事件 emitter,无输出缓冲(getOutputBuffer → null)。 */
const hoisted = vi.hoisted(() => ({
  listeners: new Map<string, Array<(t: string) => void>>(),
  /** 会话输出缓冲(id → 内容):回放分支用例预置,缺省空 = 无缓冲。 */
  buffers: new Map<string, string>(),
}));

vi.mock("@kernel/host", () => ({
  ptyLiveTopic: (id: string) => `pty://out/${id}`,
  host: {
    events: {
      on: (topic: string, cb: (t: string) => void) => {
        const arr = hoisted.listeners.get(topic) ?? [];
        arr.push(cb);
        hoisted.listeners.set(topic, arr);
        return () => hoisted.listeners.set(topic, (hoisted.listeners.get(topic) ?? []).filter((f) => f !== cb));
      },
    },
    getOutputBuffer: (id: string) => hoisted.buffers.get(id) ?? null,
    observeReplayTail: () => undefined,
  },
}));

import { attachTerminalStream, writeInChunks } from "./terminalReplay";

/** 假终端:记录写入,回调走微任务模拟 xterm 异步解析。 */
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

describe("writeInChunks", () => {
  it("按 128K 分块保序写入,进度逐块推进", async () => {
    const term = fakeTerm();
    const text = "a".repeat(128 * 1024) + "b".repeat(128 * 1024) + "c";
    const progress: Array<[number, number]> = [];
    await writeInChunks(term, text, (done, total) => progress.push([done, total]));
    expect(term.writes.map((w) => w.length)).toEqual([128 * 1024, 128 * 1024, 1]);
    expect(term.writes.join("")).toBe(text);
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("空文本零写入直接完成", async () => {
    const term = fakeTerm();
    const progress: Array<[number, number]> = [];
    await writeInChunks(term, "", (done, total) => progress.push([done, total]));
    expect(term.writes).toEqual([]);
    expect(progress).toEqual([[0, 0]]);
  });
});

/** 向会话推一段实时输出。 */
function emit(id: string, text: string) {
  for (const cb of hoisted.listeners.get(`pty://out/${id}`) ?? []) cb(text);
}

/** 空操作输入闸(本组用例不涉回放重写)。 */
const gate = { arm: () => undefined, release: () => undefined, blocked: () => false };

describe("attachTerminalStream 就绪锁", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    hoisted.listeners.clear();
  });

  it("撤罩后实时字节照常写幕布,但不再重提遮罩", () => {
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s1", gate, (p) => events.push(p));

    emit("s1", "hello");
    vi.advanceTimersByTime(500); // 静默判就绪 → 撤罩
    expect(events).toEqual([
      { kind: "stream", chars: 0 },
      { kind: "stream", chars: 5 },
      null,
    ]);

    // 就绪后来字节(spinner / 切模型回显 / resize 重绘):写入照常,遮罩不回弹
    emit("s1", "spinner-frame");
    vi.advanceTimersByTime(2_000);
    expect(term.writes).toEqual(["hello", "spinner-frame"]);
    expect(events).toHaveLength(3);
    off();
  });

  it("撤罩前持续输出重置静默计时,遮罩保持到安静 0.5s", () => {
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s2", gate, (p) => events.push(p));

    for (let i = 0; i < 3; i++) {
      emit("s2", "x");
      vi.advanceTimersByTime(400); // 间隔 < 静默窗,不就绪
    }
    expect(events).not.toContain(null);

    vi.advanceTimersByTime(500); // 真静默 → 撤罩
    expect(events.at(-1)).toBeNull();
    off();
  });

  it("持续输出超 12s 走兜底撤罩,之后不再回弹", () => {
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s3", gate, (p) => events.push(p));

    emit("s3", "boot");
    vi.advanceTimersByTime(12_000); // 兜底
    expect(events.at(-1)).toBeNull();

    emit("s3", "more");
    vi.advanceTimersByTime(2_000);
    expect(events.filter((e) => e === null)).toHaveLength(1);
    expect(term.writes).toEqual(["boot", "more"]);
    off();
  });

  it("回放中途撤罩后,剩余回放块不再重提遮罩", async () => {
    hoisted.buffers.set("s4", "chunk-a chunk-b"); // 有缓冲 → 走回放分支
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s4", gate, (p) => events.push(p));

    emit("s4", "live"); // 回放窗口内到达实时字节:入队迟到补写,并重置静默表
    await vi.advanceTimersByTimeAsync(500); // 实时侧静默判就绪 → 撤罩;回放块写完
    expect(events).toContain(null);
    expect(events.indexOf(null)).toBe(events.length - 1); // 撤罩后零重提(修前回弹 replay% 卡死遮罩)
    expect(term.writes.join("")).toContain("chunk-a chunk-b"); // 回放不丢字节
    expect(term.writes.at(-1)).toBe("live"); // 迟到实时字节按序补写
    off();
  });
});
