/** 「补齐待生成」入队策略测试:快照就绪闸 + 新到旧限量(防整月串行风暴)。 */
import { describe, expect, it, vi } from "vitest";
import { fillPendingDays } from "./journalSchedule";
import type { MonthSnapshot } from "./journalStore";
import type { DaySessionRow } from "./daySessions";

const enq = vi.fn();
vi.mock("./taskQueue", () => ({ enqueueTask: (...a: unknown[]) => enq(...a) }));
vi.mock("./journalStore", () => ({ getJournalState: () => ({ config: { engine: "omp" } }) }));
vi.mock("./genSession", () => ({ bootGenSession: () => () => undefined }));
vi.mock("./holidays", () => ({ ensureHolidays: () => Promise.resolve() }));

const snap = (articles: Record<string, unknown>): MonthSnapshot =>
  ({ articles, notes: {} }) as unknown as MonthSnapshot;
const rows = (n: number): DaySessionRow[] =>
  Array.from({ length: n }, () => ({ profileId: "omp", title: "s", startedAt: 1, modifiedAt: 1, live: false, wsName: "w" }));

describe("fillPendingDays", () => {
  it("快照未就绪不入队(防文章索引空窗误伤已有文章的日)", () => {
    fillPendingDays({ y: 2026, m: 9 }, new Map([["2026-09-30", rows(1)]]), undefined);
    expect(enq).not.toHaveBeenCalled();
  });

  it("新到旧限量 3 天:一次点按不引爆整月串行批", () => {
    fillPendingDays(
      { y: 2026, m: 9 },
      new Map([
        ["2026-09-28", rows(2)],
        ["2026-09-05", rows(1)],
        ["2026-09-30", rows(3)],
        ["2026-09-12", rows(1)],
        ["2026-09-07", rows(1)],
        ["2026-09-03", rows(1)],
      ]),
      snap({ "16": null }),
    );
    expect(enq).toHaveBeenCalledTimes(3);
    expect(enq.mock.calls.map((c) => c[1])).toEqual(["2026-09-30", "2026-09-28", "2026-09-12"]);
  });

  it("已有文章的日与非本月前缀跳过", () => {
    fillPendingDays(
      { y: 2026, m: 9 },
      new Map([
        ["2026-09-16", rows(2)],
        ["2026-08-31", rows(2)],
        ["2026-09-29", rows(2)],
      ]),
      snap({ "16": ({ title: "t" } as unknown) }),
    );
    expect(enq).toHaveBeenCalledTimes(1);
    expect(enq.mock.calls[0][1]).toBe("2026-09-29");
  });
});
