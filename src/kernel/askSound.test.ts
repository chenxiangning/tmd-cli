/**
 * Ask 提示音行为契约测试(askDetected 消费端形态)。
 * 检测契约已随检测上收移至 askWatch.test.ts(见 openspec/changes/add-ask-badge);
 * 本文件覆盖:bootAskSound 事件接线(开关开着即播放)、重复 boot 幂等、
 * 关闭静默、非法音效回落、直呼播放(设置页测试按钮路径)。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例;
 * Audio 以 stub 全局类捕获播放调用(node 环境无 Web Audio)。
 * 否定断言(不播放)用「对照事件冲洗管线」确定性证明:先制造一次可等待的播放,
 * 再断言总数 —— 推测性 sleep 会掩蔽竞态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type SettingsModule = typeof import("./settings");
type AskSoundModule = typeof import("./askSound");
type EventsModule = typeof import("./events");

let settings: SettingsModule;
let askSound: AskSoundModule;
let events: EventsModule;

/** 捕获 new Audio(url) 的播放请求。 */
const audioUrls: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例;
  // askSound 与 settings/events 同批 import,共享同一份全新单例。
  settings = await import("./settings");
  askSound = await import("./askSound");
  events = await import("./events");
  audioUrls.length = 0;
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 播放是异步链(懒加载 wav → Audio.play),以可观察信号等待落地,不用真实定时器。 */
async function waitPlayed(count: number): Promise<void> {
  await vi.waitFor(() => expect(audioUrls.length).toBe(count));
}

describe("bootAskSound 事件接线", () => {
  it("askDetected 事件触发播放", async () => {
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    bus.emit(events.KernelTopics.askDetected, "s1");
    await waitPlayed(1);
  });

  it("重复 boot 幂等:同一次事件只播一次", async () => {
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    askSound.bootAskSound(bus);
    bus.emit(events.KernelTopics.askDetected, "s2");
    await waitPlayed(1);
  });
});

describe("设置联动", () => {
  it("关闭开关时不播放(对照事件证明管线已冲洗)", async () => {
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    settings.updateSettings({ askSoundEnabled: false });
    bus.emit(events.KernelTopics.askDetected, "s11");
    settings.updateSettings({ askSoundEnabled: true });
    bus.emit(events.KernelTopics.askDetected, "s11-ctrl");
    await waitPlayed(1);
    expect(audioUrls.length).toBe(1);
  });

  it("非法音效 id 回落 default 仍播放", async () => {
    expect(askSound.resolveAskSoundId("junk")).toBe("default");
    expect(askSound.resolveAskSoundId("bell")).toBe("bell");
    expect(askSound.resolveAskSoundId(undefined)).toBe("default");
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    settings.updateSettings({ askSoundId: "junk" as never });
    bus.emit(events.KernelTopics.askDetected, "s12");
    await waitPlayed(1);
  });

  it("playAskSound 直呼(设置页测试按钮路径)播放", async () => {
    askSound.playAskSound("ding");
    await waitPlayed(1);
  });
});
