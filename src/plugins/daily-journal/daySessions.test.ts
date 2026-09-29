/** 按日会话聚合测试(纯函数面:归日/排序/跨零点归属;活盘合并活行 modifiedAt 取大)。 */
import { describe, expect, it, vi } from "vitest";
import { collectSessionRows, groupByDay, isRowSummarized, type DaySessionRow } from "./daySessions";
import type { CliDiskSession } from "@kernel/cli";

const h = vi.hoisted(() => ({
  sessions: [] as { id: string; kind: string; engine: string; workspaceId: string; cliSessionId: string; createdAt: number }[],
  disk: [] as CliDiskSession[],
}));
vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => [{ id: "omp", listSessions: async () => h.disk }],
    getSessions: () => h.sessions,
  },
}));
vi.mock("@kernel/workspace", () => ({ getWorkspaces: () => [{ id: "w1", root: "/ws", name: "w" }] }));
vi.mock("@kernel/workspaceOrigins", () => ({ findWorkspaceOrigin: () => null }));

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

describe("collectSessionRows 活盘合并", () => {
  it("活会话命中磁盘身份:活形态保留、disk 挂载、modifiedAt 以磁盘最近写入取大", async () => {
    h.sessions = [{ id: "pty-1", kind: "cli", engine: "omp", workspaceId: "w1", cliSessionId: "u-1", createdAt: new Date("2026-09-29T09:00:00").getTime() }];
    h.disk = [{ id: "u-1", path: "/ws/x.jsonl", title: "标题", createdAt: new Date("2026-09-29T09:00:00").getTime(), modifiedAt: new Date("2026-09-29T11:30:00").getTime() }];
    const rows = await collectSessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].live).toBe(true);
    expect(rows[0].disk?.id).toBe("u-1");
    /* 防回归:活行 modifiedAt 停在 spawn 时刻会把跨水活动会话误判已归纳。 */
    expect(rows[0].modifiedAt).toBe(new Date("2026-09-29T11:30:00").getTime());
    expect(isRowSummarized(rows[0], new Date("2026-09-29T10:00:00").getTime())).toBe(false);
    h.sessions = [];
    h.disk = [];
  });
});
