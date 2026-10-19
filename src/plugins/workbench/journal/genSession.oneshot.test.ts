/**
 * genSession 无头单发(oneshotArgs 引擎)用例 —— 自 genSession.test.ts 拆出守
 * 300 行铁则;桩与辅助函数同源复制(vitest mock 面文件级隔离,复制是仓内惯例)。
 */
/** genSession 结算测试 —— 轮询捕获成文 8s 后成功/超时失败/假结算由轮询收口/补提交 CR 走 synthetic;无头单发
 *  (prompt 落盘 @file 与 stdin 递送)三态。重依赖全 mock;文件内不 resetModules(会丢 mock 登记),跨测隔离靠唯一 dayKey。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { host } from "@kernel/host";
import { enqueueTask, getGenTasks } from "./taskQueue";
import { bootGenSession } from "./genSession";
import { readText, writeText } from "./journalFiles";
import { ensureParentDir } from "@kernel/fsDirs";
import { collectSessionRowsBatched } from "./daySessions";
import { reloadDay } from "./journalStore";

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
    featureCards: (y: number, m: number, d: number) => `/fake/footprint/features/${y}-${m}-${d}.json`,
  })),
  dayKey: (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  readText: vi.fn(async () => ""),
  writeText: vi.fn(async () => undefined),
  articleChanged: (baseline: string | null, next: string | null) => next !== null && next.length > 0 && next !== baseline,
}));
vi.mock("./journalStore", () => ({
  addBead: vi.fn(),
  dayMetaOf: vi.fn(() => ({ beads: [] })),
  getJournalState: vi.fn(() => ({ config: { model: "" } })),
  reloadDay: vi.fn(async () => null),
  setDayResult: vi.fn(),
}));
vi.mock("./daySessions", async (o) => ({ ...(await o()), collectSessionRowsBatched: vi.fn(async () => []) }));
vi.mock("./promptGen", async (importOriginal) => ({
  ...(await importOriginal()),
  buildGenPrompt: vi.fn(() => "P"),
}));
vi.mock("./journalTabs", () => ({ ARTICLE_TAB_KIND: "dj-article" }));
const wb = vi.hoisted(() => ({ projects: [] as unknown[] }));
vi.mock("../store", () => ({ ensureWorkbenchLoaded: async () => {}, workbenchSnapshot: () => wb.projects }));

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
const writeSessionMock = vi.mocked(host.writeSession);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    vi.mocked(collectSessionRowsBatched).mockResolvedValue([]);
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
    vi.mocked(collectSessionRowsBatched).mockResolvedValue([]);
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
    vi.mocked(collectSessionRowsBatched).mockResolvedValue([]);
  });
});
