import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadProgress } from "./terminalReplay";

/** host mock:可控事件 emitter,无输出缓冲(getOutputBuffer → null)。 */
const hoisted = vi.hoisted(() => ({
  listeners: new Map<string, Array<(t: string) => void>>(),
  /** 会话输出缓冲(id → 内容):回放分支用例预置,缺省空 = 无缓冲。 */
  buffers: new Map<string, string>(),
  /** 会话 → CLI 磁盘身份(磁盘尾分支标签解析)。 */
  cliIds: new Map<string, string>(),
  /** restoreTail 调用记录(磁盘回放尽的徽章恢复)。 */
  restored: [] as Array<[string, string]>,
  /** 红线观测:磁盘回放期间 appendOutput 零调用(历史字节不入守望主链路)。 */
  appendOutputCalls: [] as string[],
  /** 磁盘尾桩:{ cliId, promise } = 预取命中;null = 未预取/错配。 */
  diskTail: null as { cliId: string; promise: Promise<{ text: string } | null> } | null,
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
    getCliSessionId: (id: string) => hoisted.cliIds.get(id),
    observeReplayTail: () => undefined,
    restoreDiskTail: (id: string, tail: string) => hoisted.restored.push([id, tail]),
    appendOutput: (_id: string, text: string) => hoisted.appendOutputCalls.push(text),
  },
}));

vi.mock("./diskReplay", () => ({
  consumeDiskTail: (cliId: string | undefined) =>
    hoisted.diskTail && cliId === hoisted.diskTail.cliId ? hoisted.diskTail.promise : null,
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

/** 磁盘先行回放分支(spec 2026-09-09-disk-first-session-open)。 */
describe("attachTerminalStream 磁盘先行回放", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.buffers.clear();
    hoisted.cliIds.clear();
    hoisted.restored.length = 0;
    hoisted.appendOutputCalls.length = 0;
    hoisted.diskTail = null;
  });
  afterEach(() => vi.useRealTimers());

  it("回放尽撤罩显墓碑帧,活流攒队不发;CLR 到达后 300ms 一次 flush 无白屏", async () => {
    hoisted.cliIds.set("s1", "cli-1");
    hoisted.diskTail = { cliId: "cli-1", promise: Promise.resolve({ text: "TAIL" }) };
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s1", gate, (p) => events.push(p));
    emit("s1", "LIVE1"); // promise 未决期:进队列,严禁直写(F3)
    expect(term.writes).not.toContain("LIVE1");
    await vi.advanceTimersByTimeAsync(5);
    expect(term.writes.join("")).toContain("TAIL"); // 墓碑帧可见
    expect(events).toContain(null); // 回放尽撤罩
    expect(hoisted.restored).toEqual([["s1", "TAIL"]]); // Ask 徽章磁盘恢复
    expect(hoisted.appendOutputCalls).toEqual([]); // 红线:磁盘尾巴不入守望主链路
    emit("s1", "Still starting\x1b[2J"); // CLI 启动流:无 CLR 前照常攒(防清屏白屏)
    await vi.advanceTimersByTimeAsync(200);
    expect(term.writes).not.toContain("Still starting");
    emit("s1", "\x1b[H\x1b[2JFRAME"); // 清屏 + 首屏
    await vi.advanceTimersByTimeAsync(300);
    expect(term.writes.join("")).toContain("FRAME"); // CLR+300ms 一次 flush
    expect(term.writes.some((w) => w.includes("LIVE1"))).toBe(true); // 攒队字节按序补写
    expect(events.at(-1)).toBeNull();
    off();
  });

  it("无 CLR 的纯文本 CLI:30s 兜底放行攒队", async () => {
    hoisted.cliIds.set("s1", "cli-1");
    hoisted.diskTail = { cliId: "cli-1", promise: Promise.resolve({ text: "TAIL" }) };
    const term = fakeTerm();
    const off = attachTerminalStream(term, "s1", gate, () => undefined);
    await vi.advanceTimersByTimeAsync(5);
    emit("s1", "PLAIN-LINE");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(term.writes).not.toContain("PLAIN-LINE"); // 兜底未到,墓碑帧保持
    await vi.advanceTimersByTimeAsync(1_100);
    expect(term.writes.some((w) => w.includes("PLAIN-LINE"))).toBe(true); // 30s 兜底放行
    off();
  });

  it("首开无尾(指针缺失):遮罩保持到首帧,活流攒队,CLR 后一次切换", async () => {
    hoisted.cliIds.set("s1", "cli-1");
    hoisted.diskTail = { cliId: "cli-1", promise: Promise.resolve(null) };
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s1", gate, (p) => events.push(p));
    emit("s1", "A");
    await vi.advanceTimersByTimeAsync(5);
    expect(term.writes).not.toContain("A"); // 攒队不放行(防启动清屏白屏)
    expect(events.some((e) => e?.kind === "stream")).toBe(true); // 「正在连接…」流式进度
    await vi.advanceTimersByTimeAsync(600);
    expect(events).not.toContain(null); // 静默不撤罩,遮罩保持到首帧
    emit("s1", "\x1b[H\x1b[2JFRAME");
    await vi.advanceTimersByTimeAsync(300);
    expect(term.writes.join("")).toContain("FRAME");
    expect(term.writes.some((w) => w.includes("A"))).toBe(true); // 攒队字节按序补写
    expect(events.at(-1)).toBeNull(); // 首帧切换后撤罩
    expect(hoisted.restored).toEqual([]); // 无尾不恢复徽章
    off();
  });

  it("新会话/无预取槽:直流通路,流式静默 0.5s 判就绪", async () => {
    hoisted.cliIds.set("s1", "cli-1");
    /* hoisted.diskTail 保持 null = 无槽(createSession 路径),不建 slot */
    const term = fakeTerm();
    const events: LoadProgress[] = [];
    const off = attachTerminalStream(term, "s1", gate, (p) => events.push(p));
    emit("s1", "A");
    expect(term.writes).toContain("A"); // 直流,不攒队
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toContain(null); // 静默 0.5s 撤罩(新会话现状语义)
    off();
  });

  it("身份错配不消费:内存缓冲与磁盘尾皆无时零回放", async () => {
    hoisted.cliIds.set("s1", "cli-1");
    hoisted.diskTail = { cliId: "cli-9", promise: Promise.resolve({ text: "OTHER" }) };
    const term = fakeTerm();
    const off = attachTerminalStream(term, "s1", gate, () => undefined);
    await vi.advanceTimersByTimeAsync(5);
    expect(term.writes).toEqual([]);
    expect(hoisted.restored).toEqual([]);
    off();
  });
});
