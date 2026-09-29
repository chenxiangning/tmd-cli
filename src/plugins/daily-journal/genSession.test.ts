/** genSession 结算测试 —— 落盘轮询兜底(omp 系无 editMarks 的唯一引擎无关完工信号):
 *  轮询捕获成文 → 8s 容忍后成功;无文章到超时 → 失败;turnSettled 假结算后仍由轮询收口;
 *  补提交 CR 必须 synthetic(不碰轮次守望)。重依赖全 mock;文件内不 resetModules
 *  (会丢 mock 登记),跨测隔离靠唯一 dayKey + mock 态显式重置。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { host } from "@kernel/host";
import { enqueueTask, getGenTasks } from "./taskQueue";
import { bootGenSession } from "./genSession";
import { readText } from "./journalFiles";
import { reloadDay, setDayResult } from "./journalStore";

vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: vi.fn(() => [{ id: "omp" }]),
    createSession: vi.fn(async () => ({ id: "pty-1" })),
    writeSession: vi.fn(async () => true),
  },
}));
vi.mock("@kernel/events", () => ({
  KernelTopics: {
    turnSettled: "kernel.sessions.turn.settled",
    sessionExited: "kernel.sessions.exited",
    fileEditDetected: "kernel.sessions.fileEdit.detected",
  },
}));
vi.mock("@kernel/tabs", () => ({ updateTab: vi.fn() }));
vi.mock("@kernel/profileSend", () => ({ prepareSendPayload: vi.fn(() => ({ text: "P" })) }));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: vi.fn(() => [{ id: "w1", root: "/ws", name: "w" }]),
}));
vi.mock("@kernel/workspaceOrigins", () => ({ findWorkspaceOrigin: vi.fn(() => null) }));
vi.mock("./journalFiles", () => ({
  dailyPaths: vi.fn(async () => ({ article: (y: number, m: number, d: number) => `/fake/${y}-${m}-${d}.md` })),
  dayKey: (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  readText: vi.fn(async () => ""),
}));
vi.mock("./journalStore", () => ({
  addBead: vi.fn(),
  dayMetaOf: vi.fn(() => ({ beads: [] })),
  getJournalState: vi.fn(() => ({ config: { model: "" } })),
  reloadDay: vi.fn(async () => null),
  setDayResult: vi.fn(),
}));
vi.mock("./daySessions", () => ({ collectSessionRows: vi.fn(async () => []) }));
vi.mock("./promptGen", () => ({ buildGenPrompt: vi.fn(() => "P") }));
vi.mock("./journalTabs", () => ({ ARTICLE_TAB_KIND: "dj-article" }));

interface Bus {
  on<T>(topic: string, fn: (e: T) => void): () => void;
  emit<T>(topic: string, e: T): void;
}

/** 最小事件总线(bootGenSession 只用 on/退订)。 */
function makeBus(): Bus {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    on: <T,>(topic: string, fn: (e: T) => void) => {
      handlers.set(topic, fn as (e: unknown) => void);
      return () => handlers.delete(topic);
    },
    emit: <T,>(topic: string, e: T) => handlers.get(topic)?.(e),
  };
}

const taskOf = (dayKey: string) => getGenTasks().find((t) => t.dayKey === dayKey);
const readTextMock = vi.mocked(readText);
const reloadDayMock = vi.mocked(reloadDay);
const setDayResultMock = vi.mocked(setDayResult);
const writeSessionMock = vi.mocked(host.writeSession);

/** 走完 spawn→sleep(1200)→写 prompt 的启动段,任务进入 run。 */
async function startRun(dayKey: string, bus?: Bus): Promise<void> {
  readTextMock.mockReset().mockResolvedValue("");
  reloadDayMock.mockReset().mockResolvedValue(null);
  setDayResultMock.mockClear();
  writeSessionMock.mockClear();
  bootGenSession(bus ?? makeBus());
  expect(enqueueTask("手动生成", dayKey, "omp")).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1300); /* 冷启动 sleep(1200) + 微任务清账 */
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("genSession 结算", () => {
  it("轮询捕获落盘 → 8s 容忍后成功结算并停轮", async () => {
    const key = "2026-09-16";
    await startRun(key);
    expect(taskOf(key)?.st).toBe("run");

     readTextMock.mockResolvedValue("# 文章");
    reloadDayMock.mockResolvedValue({ title: "测试标题", lede: "", secs: [], open: [] });
    await vi.advanceTimersByTimeAsync(15_000); /* 首个轮询 tick 命中 */
    expect(taskOf(key)?.text).toContain("已检测到文章写入");
    await vi.advanceTimersByTimeAsync(8_000); /* 容忍窗过 → finalize */
    expect(taskOf(key)?.st).toBe("done");
    expect(taskOf(key)?.text).toContain("已落盘");
    expect(setDayResultMock).toHaveBeenCalledWith(key, expect.objectContaining({ lastError: undefined }));

    const calls =  readTextMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); /* 轮询必须已停 */
    expect( readTextMock.mock.calls.length).toBe(calls);
  });

  it("无文章到超时 → 失败落账(文案与 10min 实值一致)", async () => {
    const key = "2026-09-15";
    await startRun(key);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(taskOf(key)?.st).toBe("err");
    expect(taskOf(key)?.text).toContain("10 分钟");
    expect(setDayResultMock).toHaveBeenCalledWith(key, expect.objectContaining({ lastError: expect.stringContaining("超时") }));
  });

  it("turnSettled 假结算(文章未现)不终态,轮询兜底收口", async () => {
    const key = "2026-09-14";
    const bus = makeBus();
    await startRun(key, bus);
    bus.emit("kernel.sessions.turn.settled", { sessionId: "pty-1" }); /* 假结算:reloadDay 仍 null */
    await vi.advanceTimersByTimeAsync(0);
    expect(taskOf(key)?.st).toBe("run");

     readTextMock.mockResolvedValue("# 文章");
    reloadDayMock.mockResolvedValue({ title: "测试标题", lede: "", secs: [], open: [] });
    await vi.advanceTimersByTimeAsync(15_000 + 8_000);
    expect(taskOf(key)?.st).toBe("done");
  });

  it("补提交裸 CR 走 synthetic(不碰轮次守望)", async () => {
    const key = "2026-09-13";
    await startRun(key);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(writeSessionMock).toHaveBeenCalledWith("pty-1", "\r", true);
  });
});
