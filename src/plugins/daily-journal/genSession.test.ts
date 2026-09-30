/** genSession 结算测试 —— 轮询捕获成文 8s 后成功/超时失败/假结算由轮询收口/补提交 CR 走 synthetic;无头单发
 *  (prompt 落盘 @file 与 stdin 递送)三态。重依赖全 mock;文件内不 resetModules(会丢 mock 登记),跨测隔离靠唯一 dayKey。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { host } from "@kernel/host";
import { cancelTask, enqueueTask, getGenTasks } from "./taskQueue";
import { bootGenSession } from "./genSession";
import { readText, writeText } from "./journalFiles";
import { ensureParentDir } from "@kernel/fsDirs";
import { collectSessionRows, type DaySessionRow } from "./daySessions";
import { buildGenPrompt } from "./promptGen";
import { reloadDay, setDayResult } from "./journalStore";

vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: vi.fn(() => [{ id: "omp" }]),
    createSession: vi.fn(async () => ({ id: "pty-1" })),
    writeSession: vi.fn(async () => true),
    removeSession: vi.fn(async () => undefined),
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
vi.mock("@kernel/fsDirs", () => ({
  ensureParentDir: vi.fn(async () => undefined),
}));
vi.mock("./journalFiles", () => ({
  dailyPaths: vi.fn(async () => ({
    article: (y: number, m: number, d: number) => `/fake/${y}-${m}-${d}.md`,
    digest: (y: number, m: number, d: number) => `/fake/digest-${y}-${m}-${d}.md`,
    prompt: (y: number, m: number, d: number) => `/fake/prompt-${y}-${m}-${d}.md`,
  })),
  dayKey: (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  readText: vi.fn(async () => ""),
  writeText: vi.fn(async () => undefined),
}));
vi.mock("./journalStore", () => ({
  addBead: vi.fn(),
  dayMetaOf: vi.fn(() => ({ beads: [] })),
  getJournalState: vi.fn(() => ({ config: { model: "" } })),
  reloadDay: vi.fn(async () => null),
  setDayResult: vi.fn(),
}));
vi.mock("./daySessions", () => ({ collectSessionRows: vi.fn(async () => []) }));
vi.mock("./promptGen", async (importOriginal) => ({
  ...(await importOriginal()),
  buildGenPrompt: vi.fn(() => "P"),
}));
vi.mock("./journalTabs", () => ({ ARTICLE_TAB_KIND: "dj-article" }));

interface Bus {
  on<T>(topic: string, fn: (e: T) => void): () => void;
  emit<T>(topic: string, e: T): void;
}

function makeBus(): Bus { /* 最小事件总线(bootGenSession 只用 on/退订) */
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

/** 结算两输入源复位:读盘空 + 当日重载空(各测试自备后续桩)。 */
function resetSettleMocks(): void {
  readTextMock.mockReset().mockResolvedValue(""); /* 读盘空:文章不存在 */
  reloadDayMock.mockReset().mockResolvedValue(null); /* 当日重载空 */
}
const readTextMock = vi.mocked(readText);
const reloadDayMock = vi.mocked(reloadDay);
const setDayResultMock = vi.mocked(setDayResult);
const writeSessionMock = vi.mocked(host.writeSession);

/** 走完 spawn→sleep(1200)→写 prompt 的启动段,任务进入 run。 */
async function startRun(dayKey: string, bus?: Bus): Promise<void> {
  resetSettleMocks();
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

  it("摘录在位:转录块 → digest 落盘 + prompt 携带摘录路径", async () => {
    vi.mocked(host.getCliProfiles).mockReturnValue([
      {
        id: "omp",
        readSessionTranscript: vi.fn(async () => ({
          blocks: [
            { id: "b1", role: "user", text: "工作区选择器点不开,报 TypeError" },
            { id: "b2", role: "reasoning", text: "内部思考不入摘录" },
            { id: "b3", role: "tool", text: "", tool: { title: "pnpm test", status: "error", detail: "3 failed" } },
            { id: "b4", role: "assistant", text: "定位到 isExpanded 未初始化,已修复" },
          ],
        })),
      },
    ] as never);
    const row: DaySessionRow = {
      profileId: "omp",
      id: "s1",
      title: "修复工作区选择器",
      startedAt: new Date("2026-09-12T10:00:00").getTime(),
      modifiedAt: new Date("2026-09-12T10:30:00").getTime(),
      live: false,
      wsName: "demo",
      disk: { id: "s1", path: "/fake/s1.jsonl", modifiedAt: 0 },
    };
    vi.mocked(collectSessionRows).mockResolvedValue([row]);
    const key = "2026-09-12";
    await startRun(key);
    expect(writeText).toHaveBeenCalledWith(
      "/fake/digest-2026-9-12.md",
      expect.stringContaining("### 10:00 [omp] 修复工作区选择器(demo)"),
    );
    const digest = vi.mocked(writeText).mock.calls.find((c) => c[0] === "/fake/digest-2026-9-12.md")?.[1] as string;
    expect(digest).toContain("用户:工作区选择器点不开");
    expect(digest).toContain("报错:pnpm test — 3 failed");
    expect(digest).toContain("助手:定位到 isExpanded 未初始化");
    expect(digest).not.toContain("内部思考");
    expect(ensureParentDir).toHaveBeenCalledWith("/fake/digest-2026-9-12.md");
    expect(buildGenPrompt).toHaveBeenCalledWith(
      2026,
      9,
      12,
      expect.anything(),
      false,
      "/fake/2026-9-12.md",
      undefined,
      { path: "/fake/digest-2026-9-12.md", coveredIds: ["s1"] },
    );
    /* 收口任务(终态释放单并发队列,不饿死后续用例)。 */
    readTextMock.mockResolvedValue("# 文章");
    reloadDayMock.mockResolvedValue({ title: "t", lede: "", secs: [], open: [] });
    await vi.advanceTimersByTimeAsync(15_000 + 8_000);
    expect(taskOf(key)?.st).toBe("done");
    /* 收割防回归:终态后生成会话必须被移除(僵尸 TUI 实测存活 48 分钟)。 */
    expect(host.removeSession).toHaveBeenCalledWith("pty-1");
    vi.mocked(collectSessionRows).mockResolvedValue([]);
  });
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

  it("无文章到超时 → 失败落账(文案与 15min 实值一致)", async () => {
    const key = "2026-09-15";
    await startRun(key);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(taskOf(key)?.st).toBe("err");
    expect(taskOf(key)?.text).toContain("15 分钟");
    expect(setDayResultMock).toHaveBeenCalledWith(key, expect.objectContaining({ lastError: expect.stringContaining("超时") }));
    expect(host.removeSession).toHaveBeenCalledWith("pty-1"); /* 超时路径同样收割 */
  });

  it("run 态终止:挂起 spawn 中取消 → 会话落地即弃,不复活", async () => {
    const key = "2026-09-12";
    resetSettleMocks();
    writeSessionMock.mockClear();
    /* spawn 挂起闸:任务已泵起但卡在 createSession(无兜底窗口)。 */
    const { promise: spawnPend, resolve: landSpawn } = Promise.withResolvers<{ id: string }>();
    vi.mocked(host.createSession).mockImplementationOnce(() => spawnPend as never);
    bootGenSession(makeBus());
    expect(enqueueTask("手动生成", key, "omp")).not.toBeNull();
    expect(taskOf(key)?.st).toBe("run");
    expect(cancelTask(taskOf(key)!.id)).toBe(true); /* 挂起期间终止 */
    landSpawn({ id: "pty-2" }); /* 迟到的 spawn 落地 */
    await vi.advanceTimersByTimeAsync(0);
    expect(host.removeSession).toHaveBeenCalledWith("pty-2"); /* 检查点自弃 */
    expect(writeSessionMock).not.toHaveBeenCalled(); /* 不再送 prompt */
    expect(taskOf(key)?.st).toBe("err");
    expect(taskOf(key)?.sessionId).toBeUndefined(); /* 迟到绑定不复活 */
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

describe("genSession 无头单发(oneshotArgs 引擎)", () => {

  it("prompt 落盘经 @file 传入 + createSession 携 oneshot,不写 PTY 不等冷启动", async () => {
    vi.mocked(host.getCliProfiles).mockReturnValue([{ id: "omp", oneshotArgs: () => [] }] as never);
    const key = "2026-09-18";
    const bus = makeBus();
    resetSettleMocks();
    writeSessionMock.mockClear();
    vi.mocked(host.createSession).mockClear();
    bootGenSession(bus);
    expect(enqueueTask("手动生成", key, "omp")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0); /* 无头路径无冷启动等待,一拍即入 run */
    expect(taskOf(key)?.st).toBe("run");
    expect(writeText).toHaveBeenCalledWith("/fake/prompt-2026-9-18.md", "P"); /* buildGenPrompt 已 mock,原文传写 */
    expect(ensureParentDir).toHaveBeenCalledWith("/fake/prompt-2026-9-18.md");
    expect(vi.mocked(host.createSession)).toHaveBeenCalledWith("omp", "/ws", "w1",
      expect.objectContaining({ activate: false, oneshot: { promptFile: "/fake/prompt-2026-9-18.md" } }));
    expect(writeSessionMock).not.toHaveBeenCalled(); /* 无头不走 PTY 写入,补 CR 也无 */
    expect(taskOf(key)?.text).toContain("无头生成");
    /* 退出即主结算信号:文章在 = 成功(无 turnSettled 依赖)。 */
    readTextMock.mockResolvedValue("# 文章");
    reloadDayMock.mockResolvedValue({ title: "无头产出", lede: "", secs: [], open: [] });
    bus.emit("kernel.sessions.exited", "pty-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(taskOf(key)?.st).toBe("done");
    expect(host.removeSession).toHaveBeenCalledWith("pty-1");
    vi.mocked(collectSessionRows).mockResolvedValue([]);
  });

  it("退出但无文章 → 中性失败文案(可重试)", async () => {
    vi.mocked(host.getCliProfiles).mockReturnValue([{ id: "omp", oneshotArgs: () => [] }] as never);
    const key = "2026-09-17";
    const bus = makeBus();
    resetSettleMocks();
    bootGenSession(bus);
    expect(enqueueTask("手动生成", key, "omp")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    bus.emit("kernel.sessions.exited", "pty-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(taskOf(key)?.st).toBe("err");
    expect(taskOf(key)?.text).toContain("会话退出但未产出文章");
    vi.mocked(collectSessionRows).mockResolvedValue([]);
  });

  it("stdin 递送引擎(oneshotStdin):spawn 后 writeSession 注入 prompt 全文", async () => {
    vi.mocked(host.getCliProfiles).mockReturnValue([{ id: "codex", oneshotArgs: () => [], oneshotStdin: true }] as never);
    const key = "2026-09-11";
    resetSettleMocks();
    writeSessionMock.mockReset().mockResolvedValue(true);
    bootGenSession(makeBus());
    expect(enqueueTask("手动生成", key, "codex")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(taskOf(key)?.st).toBe("run");
    expect(writeSessionMock).toHaveBeenCalledWith("pty-1", "P"); /* prompt 全文走 stdin */
    /* 收口:落盘轮询捕获文章 → 成功(退出与轮询两路共用 finalize)。 */
    readTextMock.mockResolvedValue("# 文章");
    reloadDayMock.mockResolvedValue({ title: "t", lede: "", secs: [], open: [] });
    await vi.advanceTimersByTimeAsync(15_000 + 8_000);
    expect(taskOf(key)?.st).toBe("done");
    vi.mocked(collectSessionRows).mockResolvedValue([]);
  });
});
