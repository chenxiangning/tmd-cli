/** 按日会话聚合测试(纯函数面:归日/排序/跨零点归属)。 */
import { describe, expect, it } from "vitest";
import { groupByDay, isRowSummarized, type DaySessionRow } from "./daySessions";

const row = (profileId: string, iso: string, title = "s"): DaySessionRow => ({
  profileId,
  title,
  startedAt: new Date(iso).getTime(),
  modifiedAt: new Date(iso).getTime(),
  live: false,
  wsName: "ws",
});

describe("isRowSummarized", () => {
  it("无水位(尚无成功生成)恒 false", () => {
    expect(isRowSummarized(row("omp", "2026-09-29T10:00:00"), undefined)).toBe(false);
  });
  it("水位前活动 = 已并入;水位后活动 = 待增量", () => {
    const at = new Date("2026-09-29T12:00:00").getTime();
    expect(isRowSummarized(row("omp", "2026-09-29T10:00:00"), at)).toBe(true);
    expect(isRowSummarized(row("omp", "2026-09-29T12:00:00"), at)).toBe(true);
    expect(isRowSummarized(row("omp", "2026-09-29T12:00:01"), at)).toBe(false);
  });
});

describe("groupByDay", () => {
  it("按开始日归档 + 日内升序", () => {
    const map = groupByDay([row("omp", "2026-09-29T22:00:00"), row("kimi", "2026-09-29T09:00:00"), row("omp", "2026-09-28T23:50:00")]);
    expect([...map.keys()]).toEqual(["2026-09-28", "2026-09-29"]);
    expect(map.get("2026-09-29")!.map((r) => r.profileId)).toEqual(["kimi", "omp"]);
  });

  it("跨零点晚归会话(23:50 开始)归前一日", () => {
    const map = groupByDay([row("omp", "2026-09-28T23:50:00")]);
    expect(map.has("2026-09-28")).toBe(true);
    expect(map.has("2026-09-29")).toBe(false);
  });

  it("空输入 → 空索引", () => {
    expect(groupByDay([]).size).toBe(0);
  });
});
