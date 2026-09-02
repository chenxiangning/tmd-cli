/**
 * 轮次结束提示音(延迟确认)行为契约测试。
 * 覆盖:未查看结算播放、确认窗内被查看/来新输出静默放弃、unviewed=false 不排程、
 * 开关关闭静默、后续结算重置确认窗(单次播放)、bootTurnSound 总线接线。
 * 依赖经 TurnSoundDeps 注入(host 查询/播放全为内存 stub,不牵真 host 状态机);
 * Audio/wav 不进本链路(play stub),模块级单例经 resetModules 每用例取新。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
  sessionSpawn: vi.fn(),
  sessionList: vi.fn(),
  sessionKill: vi.fn(),
  sessionWrite: vi.fn(),
  onPtyOutput: vi.fn(),
  onPtyExit: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: ipcMock,
  onPtyOutput: ipcMock.onPtyOutput,
  onPtyExit: ipcMock.onPtyExit,
}));

type TurnSoundModule = typeof import("./turnSound");
type SettingsModule = typeof import("./settings");
type EventsModule = typeof import("./events");

let turnSound: TurnSoundModule;
let settings: SettingsModule;
let events: EventsModule;

/** 内存态双查表 + 播放记录:测试直接拨动其值模拟复查路径。 */
function makeDeps() {
  const played: unknown[] = [];
  const unread = new Set<string>();
  const lastAt = new Map<string, number>();
  return {
    played,
    unread,
    lastAt,
    deps: {
      isUnread: (id: string) => unread.has(id),
      getLastActivityAt: (id: string) => lastAt.get(id) ?? 0,
      play: (soundId: unknown) => played.push(soundId),
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,resetModules 后同批取全新一套。
  settings = await import("./settings");
  turnSound = await import("./turnSound");
  events = await import("./events");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("延迟确认语义", () => {
  it("未查看结算:静默满 3s 播放一次(默认音效)", async () => {
    vi.useFakeTimers();
    const ctx = makeDeps();
    ctx.unread.add("s1");
    const settledAt = Date.now();
    ctx.lastAt.set("s1", settledAt);
    turnSound.observeTurnSettled({ sessionId: "s1", unviewed: true, settledAt }, ctx.deps);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(ctx.played).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(ctx.played).toEqual(["default"]);
  });

  it("确认窗内点开查看(markViewed)→ 静默放弃", async () => {
    vi.useFakeTimers();
    const ctx = makeDeps();
    ctx.unread.add("s2");
    const settledAt = Date.now();
    ctx.lastAt.set("s2", settledAt);
    turnSound.observeTurnSettled({ sessionId: "s2", unviewed: true, settledAt }, ctx.deps);
    ctx.unread.delete("s2"); // 用户点开
    await vi.advanceTimersByTimeAsync(3_100);
    expect(ctx.played).toHaveLength(0);
  });

  it("确认窗内来新输出(时间戳推进)→ 静默放弃", async () => {
    vi.useFakeTimers();
    const ctx = makeDeps();
    ctx.unread.add("s3");
    const settledAt = Date.now();
    ctx.lastAt.set("s3", settledAt);
    turnSound.observeTurnSettled({ sessionId: "s3", unviewed: true, settledAt }, ctx.deps);
    await vi.advanceTimersByTimeAsync(1_000);
    ctx.lastAt.set("s3", settledAt + 1_000); // 新一轮输出进站
    await vi.advanceTimersByTimeAsync(2_100);
    expect(ctx.played).toHaveLength(0);
  });

  it("unviewed=false 的结算不排程(正在查看不打扰)", async () => {
    vi.useFakeTimers();
    const ctx = makeDeps();
    turnSound.observeTurnSettled(
      { sessionId: "s4", unviewed: false, settledAt: Date.now() },
      ctx.deps,
    );
    await vi.advanceTimersByTimeAsync(3_100);
    expect(ctx.played).toHaveLength(0);
  });

  it("开关关闭 → 结算不排程", async () => {
    vi.useFakeTimers();
    settings.updateSettings({ turnEndSoundEnabled: false });
    const ctx = makeDeps();
    ctx.unread.add("s5");
    turnSound.observeTurnSettled(
      { sessionId: "s5", unviewed: true, settledAt: Date.now() },
      ctx.deps,
    );
    await vi.advanceTimersByTimeAsync(3_100);
    expect(ctx.played).toHaveLength(0);
  });

  it("确认窗内再次结算:重置窗口,只播一次", async () => {
    vi.useFakeTimers();
    const ctx = makeDeps();
    ctx.unread.add("s6");
    const first = Date.now();
    ctx.lastAt.set("s6", first);
    turnSound.observeTurnSettled({ sessionId: "s6", unviewed: true, settledAt: first }, ctx.deps);
    await vi.advanceTimersByTimeAsync(1_500);
    const second = first + 1_500;
    ctx.lastAt.set("s6", second);
    turnSound.observeTurnSettled(
      { sessionId: "s6", unviewed: true, settledAt: second },
      ctx.deps,
    );
    await vi.advanceTimersByTimeAsync(1_600); // 距首次 3.1s,距重置仅 1.6s
    expect(ctx.played).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_500); // 距重置 3.1s
    expect(ctx.played).toHaveLength(1);
  });
});

describe("bootTurnSound 总线接线", () => {
  it("订阅 turnSettled topic:事件驱动同语义", async () => {
    vi.useFakeTimers();
    const ctx = makeDeps();
    const bus = new events.EventBus();
    turnSound.bootTurnSound(bus, ctx.deps);
    ctx.unread.add("w1");
    const settledAt = Date.now();
    ctx.lastAt.set("w1", settledAt);
    bus.emit(events.KernelTopics.turnSettled, {
      sessionId: "w1",
      unviewed: true,
      settledAt,
    });
    await vi.advanceTimersByTimeAsync(3_100);
    expect(ctx.played).toEqual(["default"]);
  });
});
