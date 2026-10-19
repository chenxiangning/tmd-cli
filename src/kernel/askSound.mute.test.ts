/**
 * Ask 提示音 × 会话静音闸(bootAskSound 的 askDetected 消费端短路)。
 * 覆盖:full 档拦 ask 音、full+askRing 穿透、mute/snooze 档 ask 穿透、取消静音恢复。
 * host 以桩身份表注入(仅 askSound 的会话查名消费;settings/sessionMutes 单例经
 * resetModules 全新实例,同 askSound.test);不播放的否定断言用「对照事件冲洗管线」
 * 确定性证明(同 askSound.test 铁律:先证管线可播,再断言播放总数)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBus } from "./events";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
/* 会话身份桩:仅 tmd1→KEY_A / tmd2→KEY_B 两行;表外 id 视为未落盘(不静音)。 */
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
type AskSoundModule = typeof import("./askSound");
type EventsModule = typeof import("./events");
type MutesModule = typeof import("./sessionMutes");

let settings: SettingsModule;
let askSound: AskSoundModule;
let events: EventsModule;
let mutes: MutesModule;

const audioUrls: string[] = [];
const KEY_A = "ws1:claude:sess-a";
/* askUnlisten 是模块级单例(重复 boot 幂等):总线必须每用例随模块一起重建,
   否则第二个 it 的新 bus 上没有监听器(askSound.test 同约束)。 */
let bus: EventBus;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,resetModules 后同批取全新一套。
  settings = await import("./settings");
  askSound = await import("./askSound");
  events = await import("./events");
  mutes = await import("./sessionMutes");
  audioUrls.length = 0;
  bus = new events.EventBus();
  askSound.bootAskSound(bus);
  class FakeAudio {
    volume = 1;
    constructor(url: string) {
      audioUrls.push(url);
    }
    play(): Promise<void> {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 播放是异步链(懒加载 wav → Audio.play),以可观察信号等待落地。 */
async function waitPlayed(count: number): Promise<void> {
  await vi.waitFor(() => expect(audioUrls.length).toBe(count));
}

function mute(mode: "mute" | "full" | "snooze", askRing?: boolean) {
  settings.updateSettings({
    sessionMutes: { [KEY_A]: { mutedAt: 1, mode, ...(askRing === undefined ? {} : { askRing }) } },
  });
}

describe("bootAskSound × 会话静音", () => {
  it("full 档拦 ask 音:静音事件零播放,同批未静音对照(tmd2)恰一次", async () => {
    mute("full");
    bus.emit(events.KernelTopics.askDetected, "tmd1"); /* 被静音闸拦 */
    bus.emit(events.KernelTopics.askDetected, "tmd2"); /* 对照:管线可播 */
    await waitPlayed(1); /* 只有对照响了 */
  });

  it("ask 穿透三态:full+askRing / mute / snooze 档 ask 音照播", async () => {
    const cases = [
      { name: "full+askRing=true", mode: "full", askRing: true },
      { name: "mute 档", mode: "mute" },
      { name: "snooze 档", mode: "snooze" },
    ] as const;
    for (const c of cases) {
      audioUrls.length = 0;
      mute(c.mode, "askRing" in c ? c.askRing : undefined);
      bus.emit(events.KernelTopics.askDetected, "tmd1");
      await waitPlayed(1);
    }
  });

  it("取消静音后恢复播放(先静音拦一事件,unmute 后再事件照播)", async () => {
    mute("full");
    bus.emit(events.KernelTopics.askDetected, "tmd1");
    bus.emit(events.KernelTopics.askDetected, "tmd2"); /* 冲洗对照 */
    await waitPlayed(1);
    mutes.unmuteSession(KEY_A);
    bus.emit(events.KernelTopics.askDetected, "tmd1");
    await waitPlayed(2);
  });
});
