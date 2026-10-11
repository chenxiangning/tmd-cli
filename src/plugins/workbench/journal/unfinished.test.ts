/** 「昨日未完」聚合口径测试:出列条件/14 天窗/便签勾选摘除/两桶装配。 */
import { describe, expect, it } from "vitest";
import { collectUnfinished, unfinishedPanelRows, type UnfinishedSessionInput } from "./unfinished";
import type { DaySessionRow } from "./daySessions";
const DAY = 24 * 3600_000;
/* 今日本地零点;now = 当天上午 8 点。 */
const todayStart = new Date("2026-10-07T00:00:00").getTime();
const now = todayStart + 8 * 3600_000;

const sess = (over: Partial<UnfinishedSessionInput>): UnfinishedSessionInput => ({
  profileId: "omp",
  title: "0.3.2 规划",
  startedAt: todayStart - DAY,
  lastActive: todayStart - 2 * 3600_000,
  live: false,
  archived: false,
  ...over,
});

describe("collectUnfinished 会话口径", () => {
  it("盘行未查看(14 天窗内)入聚合,kind=unseen", () => {
    const { sessions } = collectUnfinished([sess({})], [], { todayStart, now });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe("unseen");
  });

  it("活行跨夜挂起入聚合,kind=idle", () => {
    const { sessions } = collectUnfinished([sess({ live: true })], [], { todayStart, now });
    expect(sessions[0].kind).toBe("idle");
  });

  it("今日零点后动过的(点续/续聊)出列 —— 与手动摘除互为兜底", () => {
    const { sessions } = collectUnfinished(
      [sess({ lastActive: todayStart + 60_000 }), sess({ live: true, lastActive: todayStart + 60_000 })],
      [],
      { todayStart, now },
    );
    expect(sessions).toHaveLength(0);
  });

  it("归档标记与超 14 天窗(视作早已看过)都不入聚合;恰好 14 天整也出列", () => {
    const { sessions } = collectUnfinished(
      [sess({ archived: true }), sess({ lastActive: now - 14 * DAY }), sess({ lastActive: todayStart - 15 * DAY })],
      [],
      { todayStart, now },
    );
    expect(sessions).toHaveLength(0);
  });

  it("昨日活跃今日上午看:临界零点(=零点整)出列,零点前一刻在内", () => {
    const { sessions } = collectUnfinished(
      [sess({ lastActive: todayStart }), sess({ lastActive: todayStart - 1 })],
      [],
      { todayStart, now },
    );
    expect(sessions.map((s) => s.lastActive)).toEqual([todayStart - 1]);
  });
});

describe("collectUnfinished 便签口径", () => {
  const notes = [
    { key: "2026-10-06", text: "relay 预算常量定 6000", updatedAt: todayStart - DAY },
    { key: "2026-10-06", text: "已办结", updatedAt: todayStart - DAY, checked: true },
  ];
  it("未勾入聚合,已勾摘除", () => {
    const { notes: out } = collectUnfinished([], notes, { todayStart, now });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("relay 预算常量定 6000");
  });
});

describe("unfinishedPanelRows 两桶装配", () => {
  const row = (over: Partial<DaySessionRow>): DaySessionRow => ({
    profileId: "omp",
    title: "t",
    startedAt: todayStart - DAY,
    modifiedAt: todayStart - 2 * 3600_000,
    live: false,
    wsName: "ws",
    ...over,
  });
  it("昨日桶活行 + 全表「昨日最后写入」盘行(跨日开始桶)都进;今日写入盘行不进", () => {
    const days = new Map<string, DaySessionRow[]>([
      ["2026-10-05", [row({ startedAt: todayStart - 2 * DAY, modifiedAt: todayStart - 3 * 3600_000 })]],
      ["2026-10-06", [row({ live: true }), row({ modifiedAt: todayStart - 5 * 3600_000 })]],
      ["2026-10-07", [row({ startedAt: todayStart, modifiedAt: todayStart + 3600_000 })]],
    ]);
    const out = unfinishedPanelRows(days, "2026-10-06", todayStart - DAY, todayStart);
    expect(out).toHaveLength(3);
    expect(out.filter((r) => r.live)).toHaveLength(1);
    expect(out.some((r) => !r.live && r.startedAt === todayStart - 2 * DAY)).toBe(true);
  });
});
