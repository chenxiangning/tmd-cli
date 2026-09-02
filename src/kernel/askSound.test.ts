/**
 * Ask 提示音行为契约测试。
 * 覆盖:标记命中(omp Ask/claude 页脚/y-n 提问)、ANSI 混杂、标记跨 chunk 劈开、
 * 同轮去重、惰性轮次边界(Date 假时钟)、bootAskSound 生命周期(差分订阅/消亡清理)、
 * 关闭静默、非法音效回落。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例;
 * Audio 以 stub 全局类捕获播放调用(node 环境无 Web Audio)。
 * 否定断言(不播放)用「对照会话冲洗管线」确定性证明:先制造一次可等待的播放,
 * 再断言总数 —— 推测性 sleep 会掩蔽竞态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
  onPtyOutput: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock, onPtyOutput: ipcMock.onPtyOutput }));

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
  ipcMock.onPtyOutput.mockResolvedValue(() => undefined);
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

/** omp Ask 面板样例(带 ANSI 样式,取自真实输出形态)。 */
const OMP_ASK =
  "\x1b[1mAsk 1 questions\x1b[0m\r\n\x1b[2m[plan_confirm] · options:3\x1b[0m";

describe("标记检测与播放", () => {
  it("omp Ask 面板命中并播放一次", async () => {
    askSound.observeSessionOutput("s1", OMP_ASK);
    await waitPlayed(1);
  });

  it("claude 确认页脚命中(Esc to cancel)", async () => {
    askSound.observeSessionOutput("s2", "╭──────────╮\n Esc to cancel");
    await waitPlayed(1);
  });

  it("通用 y/n 提问命中", async () => {
    askSound.observeSessionOutput("s3", "Proceed with revert? (y/n)");
    await waitPlayed(1);
  });

  it("普通输出不误报(对照会话证明管线已冲洗)", async () => {
    askSound.observeSessionOutput("s4", "ESC to exit. Press Enter to continue.");
    askSound.observeSessionOutput("s4", "task completed in 2 questions of 10");
    askSound.observeSessionOutput("s4-ctrl", OMP_ASK);
    await waitPlayed(1);
    expect(audioUrls.length).toBe(1);
  });

  it("标记被 PTY 分片劈开仍命中(中间夹 ANSI)", async () => {
    askSound.observeSessionOutput("s5", "\x1b[33mChoose: Esc to can");
    askSound.observeSessionOutput("s5", "\x1b[0mcel");
    await waitPlayed(1);
  });

  it("转义序列跨 chunk 截断后拼接复原", () => {
    expect(askSound.stripAnsi("text\x1b" + "[31mred\x1b[0m")).toBe("textred");
  });
});

describe("每轮一次的去重语义(惰性轮次边界)", () => {
  /** 只假时钟 Date,setTimeout 等保持真实,waitPlayed 的真实事件循环不受扰。 */
  function fakeClockAt(ms: number): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ms);
  }

  it("同一静默窗口内重复渲染不重复播放(对照会话证明管线已冲洗)", async () => {
    const t0 = Date.now();
    fakeClockAt(t0);
    askSound.observeSessionOutput("s6", OMP_ASK);
    await waitPlayed(1);
    vi.setSystemTime(t0 + 1_500);
    askSound.observeSessionOutput("s6", OMP_ASK);
    askSound.observeSessionOutput("s6", "Ask 2 questions");
    askSound.observeSessionOutput("s6-ctrl", OMP_ASK);
    await waitPlayed(2);
    expect(audioUrls.length).toBe(2);
  });

  it("静默超 2s 后新一轮可再次播放", async () => {
    const t0 = Date.now();
    fakeClockAt(t0);
    askSound.observeSessionOutput("s7", OMP_ASK);
    await waitPlayed(1);
    vi.setSystemTime(t0 + 2_600);
    askSound.observeSessionOutput("s7", OMP_ASK);
    await waitPlayed(2);
  });
});

describe("bootAskSound 生命周期接线", () => {
  /** 捕获 onPtyOutput 的每会话回退,模拟 PTY 推流。 */
  function stubPtyStreams(): Map<string, (text: string) => void> {
    const cbs = new Map<string, (text: string) => void>();
    ipcMock.onPtyOutput.mockImplementation(
      (sessionId: string, cb: (text: string) => void) => {
        cbs.set(sessionId, cb);
        return Promise.resolve(() => cbs.delete(sessionId));
      },
    );
    return cbs;
  }

  it("sessionsChanged 差分订阅,新会话输出触发播放", async () => {
    const cbs = stubPtyStreams();
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    bus.emit(events.KernelTopics.sessionsChanged, [
      { id: "a" },
      { id: "b" },
    ]);
    await vi.waitFor(() => expect(cbs.has("a") && cbs.has("b")).toBe(true));
    cbs.get("a")!(OMP_ASK);
    await waitPlayed(1);
  });

  it("会话移除即清理状态:同 id 重建后从零去重", async () => {
    const cbs = stubPtyStreams();
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    bus.emit(events.KernelTopics.sessionsChanged, [{ id: "a" }]);
    await vi.waitFor(() => expect(cbs.has("a")).toBe(true));
    cbs.get("a")!(OMP_ASK);
    await waitPlayed(1);
    bus.emit(events.KernelTopics.sessionsChanged, []);
    await vi.waitFor(() => expect(cbs.has("a")).toBe(false));
    bus.emit(events.KernelTopics.sessionsChanged, [{ id: "a" }]);
    await vi.waitFor(() => expect(cbs.has("a")).toBe(true));
    cbs.get("a")!(OMP_ASK);
    await waitPlayed(2);
  });

  it("sessionExited 即时清理,未退订前输出不再误响", async () => {
    const cbs = stubPtyStreams();
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    bus.emit(events.KernelTopics.sessionsChanged, [{ id: "a" }]);
    await vi.waitFor(() => expect(cbs.has("a")).toBe(true));
    cbs.get("a")!(OMP_ASK);
    await waitPlayed(1);
    bus.emit(events.KernelTopics.sessionExited, "a");
    await vi.waitFor(() => expect(cbs.has("a")).toBe(false));
    // 退场竞态中迟到的输出:状态已清,不得再有声音
    cbs.get("a")?.(OMP_ASK);
    await vi.waitFor(() => expect(cbs.has("a")).toBe(false));
    expect(audioUrls.length).toBe(1);
  });

  it("重复 sessionsChanged 不重复订阅", async () => {
    stubPtyStreams();
    const bus = new events.EventBus();
    askSound.bootAskSound(bus);
    bus.emit(events.KernelTopics.sessionsChanged, [{ id: "a" }]);
    bus.emit(events.KernelTopics.sessionsChanged, [{ id: "a" }]);
    await vi.waitFor(() => expect(ipcMock.onPtyOutput).toHaveBeenCalled());
    expect(ipcMock.onPtyOutput).toHaveBeenCalledTimes(1);
  });
});

describe("设置联动", () => {
  it("关闭开关时不播放(对照会话证明管线已冲洗)", async () => {
    settings.updateSettings({ askSoundEnabled: false });
    askSound.observeSessionOutput("s11", OMP_ASK);
    settings.updateSettings({ askSoundEnabled: true });
    askSound.observeSessionOutput("s11-ctrl", OMP_ASK);
    await waitPlayed(1);
    expect(audioUrls.length).toBe(1);
  });

  it("非法音效 id 回落 default 仍播放", async () => {
    expect(askSound.resolveAskSoundId("junk")).toBe("default");
    expect(askSound.resolveAskSoundId("bell")).toBe("bell");
    expect(askSound.resolveAskSoundId(undefined)).toBe("default");
    settings.updateSettings({ askSoundId: "junk" as never });
    askSound.observeSessionOutput("s12", OMP_ASK);
    await waitPlayed(1);
  });

  it("playAskSound 直呼(设置页测试按钮路径)播放", async () => {
    askSound.playAskSound("ding");
    await waitPlayed(1);
  });
});
