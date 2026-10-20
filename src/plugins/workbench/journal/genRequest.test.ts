/**
 * genRequest 契约:任务类型按 文章在/上次失败 选型,引擎取日报生成配置,
 * 同日在队(enqueueTask null)回 false。手法同 useFpFix.test(vi.mock + 顶层 await import)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueTask: vi.fn(),
  readText: vi.fn(),
  dayMetaOf: vi.fn(),
}));

vi.mock("./taskQueue", () => ({
  dayGenTaskType: (failed: boolean, hasArticle: boolean) => (failed ? "重试生成" : hasArticle ? "增量并入" : "手动生成"),
  enqueueTask: mocks.enqueueTask,
}));
vi.mock("./journalFiles", () => ({
  dailyPaths: async () => ({ article: (y: number, m: number, d: number) => `/p/${y}-${m}-${d}.md` }),
  readText: mocks.readText,
}));
vi.mock("./journalStore", () => ({
  bootJournal: vi.fn(async () => undefined),
  dayMetaOf: mocks.dayMetaOf,
  getJournalState: () => ({ config: { engine: "omp" } }),
}));

const { requestDayGenerate } = await import("./genRequest");

describe("requestDayGenerate", () => {
  beforeEach(() => {
    mocks.enqueueTask.mockReset();
    mocks.readText.mockReset();
    mocks.dayMetaOf.mockReset().mockReturnValue({});
  });

  it("无文章无错误 → 手动生成,引擎取日报配置;入队成功返回 true", async () => {
    mocks.readText.mockResolvedValue(null);
    mocks.enqueueTask.mockReturnValue({ id: 1 });
    await expect(requestDayGenerate("2026-10-20")).resolves.toBe(true);
    expect(mocks.enqueueTask).toHaveBeenCalledWith("手动生成", "2026-10-20", "omp");
  });

  it("已有文章 → 增量并入;上次失败 → 重试生成", async () => {
    mocks.readText.mockResolvedValue("# 文章");
    mocks.enqueueTask.mockReturnValue({ id: 2 });
    await requestDayGenerate("2026-10-19");
    expect(mocks.enqueueTask).toHaveBeenCalledWith("增量并入", "2026-10-19", "omp");
    mocks.dayMetaOf.mockReturnValue({ lastError: "boom" });
    await requestDayGenerate("2026-10-18");
    expect(mocks.enqueueTask).toHaveBeenCalledWith("重试生成", "2026-10-18", "omp");
  });

  it("同日任务已在队(enqueueTask null)→ 返回 false", async () => {
    mocks.readText.mockResolvedValue(null);
    mocks.enqueueTask.mockReturnValue(null);
    await expect(requestDayGenerate("2026-10-20")).resolves.toBe(false);
  });
});
