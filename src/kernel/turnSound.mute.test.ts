/**
 * 轮次结束提示音 × 会话静音闸(结算刻捕获、播放刻拦截)。
 * 覆盖:mute/full/snooze 档 turn 音不播(同批未静音对照恰一次)、
 * snooze 自清(clearSnooze)后下一轮恢复播放。
 * host 以桩身份表注入(tmdSessionMuteKey 的会话查名);播放经 deps.play 记录,
 * 不牵 Audio/wav;确认窗 3s 用假时钟推进(同 turnSound.test)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
/* 会话身份桩:仅 tmd1→KEY_A(受测)/ tmd2→KEY_B(未静音对照);表外 = 未落盘。 */
vi.mock("./host", () => ({
  host: {
    getSessions: () => [
      { id: "tmd1", workspaceId: "ws1", profileId: "claude" },
      { id: "tmd2", workspaceId: "ws1", profileId: "claude" },
    ],
    getCliSessionId: (id: string) => (id === "tmd1" ? "sess-a" : id === "tmd2" ? "sess-b" : undefined),
  },
}));

type SettingsModule = typeof import("./settings");
type TurnSoundModule = typeof import("./turnSound");
type MutesModule = typeof import("./sessionMutes");

let settings: SettingsModule;
let turnSound: TurnSoundModule;
let mutes: MutesModule;

const KEY_A = "ws1:claude:sess-a";

/* 显式钩子预算:resetModules 后动态 import 重估 settings 模块图,冷机敏感(同 turnSound.test)。 */
beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
  vi.resetModules();
  vi.useFakeTimers();
  // 动态 import 例外:被测模块是模块级单例,resetModules 后同批取全新一套。
  settings = await import("./settings");
  turnSound = await import("./turnSound");
  mutes = await import("./sessionMutes");
}, 30_000);

afterEach(() => {
  vi.useRealTimers();
});

function makeDeps() {
  const played: unknown[] = [];
  /* 复查要求 lastAt === settledAt 才播:初始对齐首轮 settledAt=1_000,
     snooze 恢复用例把 tmd1 拨到第二轮的 4_000。静态表用 Record(host 真身为注册表)。 */
  const lastAt: Record<string, number> = { tmd1: 1_000, tmd2: 1_000 };
  const unread = new Set(["tmd1", "tmd2"]);
  return {
    played,
    lastAt,
    deps: {
      isUnread: (id: string) => unread.has(id),
      getLastActivityAt: (id: string) => lastAt[id] ?? 0,
      play: (soundId: unknown) => played.push(soundId),
    },
  };
}

function mute(mode: "mute" | "full" | "snooze") {
  settings.updateSettings({ sessionMutes: { [KEY_A]: { mutedAt: 1, mode } } });
}

describe("turnSettled 提示音 × 会话静音", () => {
  it("mute/full/snooze 档:3s 确认后不播;同批未静音对照(tmd2)恰一次", () => {
    const cases = ["mute", "full", "snooze"] as const;
    for (const mode of cases) {
      const { played, deps } = makeDeps();
      mute(mode);
      turnSound.observeTurnSettled({ sessionId: "tmd1", unviewed: true, settledAt: 1_000 }, deps);
      turnSound.observeTurnSettled({ sessionId: "tmd2", unviewed: true, settledAt: 1_000 }, deps);
      vi.advanceTimersByTime(3_000);
      expect(played).toEqual(["default"]); /* 仅对照响了 */
    }
  });

  it("snooze 档 clearSnooze 自清后:下一轮结算恢复播放", () => {
    const ctx = makeDeps();
    mute("snooze");
    turnSound.observeTurnSettled({ sessionId: "tmd1", unviewed: true, settledAt: 1_000 }, ctx.deps);
    vi.advanceTimersByTime(3_000);
    expect(ctx.played).toEqual([]);

    mutes.clearSnooze(KEY_A); /* notify 的 turnSettled 订阅侧等价动作 */
    ctx.lastAt.tmd1 = 4_000; /* 第二轮结算时刻推进 */
    turnSound.observeTurnSettled({ sessionId: "tmd1", unviewed: true, settledAt: 4_000 }, ctx.deps);
    vi.advanceTimersByTime(3_000);
    expect(ctx.played).toEqual(["default"]);
  });
});
