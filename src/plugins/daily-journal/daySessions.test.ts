/** 按日会话聚合测试(纯函数面:归日/排序/跨零点归属;活盘合并活行 modifiedAt 取大;
 *  批式收集分批回调进度;活行装配孤儿过滤)。 */
import { describe, expect, it, vi } from "vitest";
import {
  assembleRows,
  collectSessionRowsBatched,
  groupByDay,
  isRowSummarized,
  type DaySessionRow,
} from "./daySessions";
import type { CliDiskSession } from "@kernel/cli";

const h = vi.hoisted(() => ({
  sessions: [] as { id: string; kind: string; engine: string; workspaceId: string; cliSessionId: string; createdAt: number }[],
  profiles: [] as { id: string; listSessions: (root: string) => Promise<CliDiskSession[]> }[],
  disk: [] as CliDiskSession[],
}));
vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => (h.profiles.length ? h.profiles : [{ id: "omp", listSessions: async () => h.disk }]),
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

describe("collectSessionRowsBatched 活盘合并", () => {
  it("活会话命中磁盘身份:活形态保留、disk 挂载、modifiedAt 以磁盘最近写入取大", async () => {
    h.sessions = [{ id: "pty-1", kind: "cli", engine: "omp", workspaceId: "w1", cliSessionId: "u-1", createdAt: new Date("2026-09-29T09:00:00").getTime() }];
    h.disk = [{ id: "u-1", path: "/ws/x.jsonl", title: "标题", createdAt: new Date("2026-09-29T09:00:00").getTime(), modifiedAt: new Date("2026-09-29T11:30:00").getTime() }];
    const rows = await collectSessionRowsBatched();
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

describe("assembleRows 活行装配", () => {
  const disk = [{ id: "u-1", path: "/ws/x.jsonl", title: "标题", createdAt: 1000, modifiedAt: 2000 }];
  it("孤儿活会话(工作区集外)不混入;工作区集内正常装配", () => {
    const metas = [
      { id: "pty-1", kind: "cli", engine: "omp", workspaceId: "w1", cliSessionId: "u-1", createdAt: 500 },
      { id: "pty-2", kind: "cli", engine: "omp", workspaceId: "w-other", cliSessionId: "u-2", createdAt: 600 },
    ] as Parameters<typeof assembleRows>[2];
    const rows = assembleRows([], new Map(), metas, new Map([["w1", "w"]]));
    expect(rows.map((r) => r.id)).toEqual(["pty-1"]);
    expect(rows[0].live).toBe(true);
    expect(rows[0].wsName).toBe("w");
    expect(rows[0].wsId).toBe("w1"); /* 续聊定位凭证(openDiskSession 工作区解析) */
  });

  it("命中磁盘身份:凭证挂载 + modifiedAt 取大;未命中保持活形态", () => {
    const metas = [
      { id: "pty-1", kind: "cli", engine: "omp", workspaceId: "w1", cliSessionId: "u-1", createdAt: 500 },
      { id: "pty-2", kind: "cli", engine: "omp", workspaceId: "w1", cliSessionId: "u-none", createdAt: 600 },
    ] as Parameters<typeof assembleRows>[2];
    const rows = assembleRows([], new Map([["w1:omp:u-1", disk[0]]]), metas, new Map([["w1", "w"]]));
    expect(rows.find((r) => r.id === "pty-1")?.disk?.id).toBe("u-1");
    expect(rows.find((r) => r.id === "pty-1")?.modifiedAt).toBe(2000);
    expect(rows.find((r) => r.id === "pty-2")?.disk).toBeUndefined();
    expect(rows.every((r) => r.wsId === "w1")).toBe(true);
  });
});

describe("collectSessionRowsBatched 分批回调", () => {
  it("每个 (工作区×家族) 落定即回调累计形态;done===total 即完整 DiskScan", async () => {
    let release2: ((list: CliDiskSession[]) => void) | undefined;
    h.profiles = [
      { id: "omp", listSessions: async () => [{ id: "a-1", path: "/ws/a.jsonl", title: "A", modifiedAt: 1 }] },
      {
        id: "kimi",
        listSessions: () =>
          new Promise<CliDiskSession[]>((resolve) => {
            release2 = resolve;
          }),
      },
    ];
    const batches: { n: number; rows: number[]; done: number; total: number }[] = [];
    const pending = collectSessionRowsBatched([{ id: "w1", root: "/ws", name: "w" }] as Parameters<typeof collectSessionRowsBatched>[0], (scan, done, total) => {
      batches.push({ n: scan.diskRows.length, rows: scan.diskRows.map((r) => r.modifiedAt), done, total });
    });
    await vi.waitFor(() => expect(batches.length).toBe(1));
    expect(batches[0]).toMatchObject({ n: 1, done: 1, total: 2 });
    release2?.([{ id: "b-1", path: "/ws/b.jsonl", title: "B", modifiedAt: 2 }]);
    const rows = await pending;
    expect(batches[1]).toMatchObject({ n: 2, done: 2, total: 2 });
    /* done===total 的回调即完整 DiskScan(渲染层逐批上屏的依据)。 */
    expect(rows).toHaveLength(2);
    h.profiles = [];
  });

  it("活会话磁盘凭证不进 diskRows(进 liveDisk),终态装配仍命中", async () => {
    h.sessions = [{ id: "pty-1", kind: "cli", engine: "omp", workspaceId: "w1", cliSessionId: "u-1", createdAt: 500 }];
    h.disk = [{ id: "u-1", path: "/ws/x.jsonl", title: "标题", modifiedAt: 2000 }];
    const seen: number[] = [];
    const rows = await collectSessionRowsBatched([{ id: "w1", root: "/ws", name: "w" }] as Parameters<typeof collectSessionRowsBatched>[0], (scan) => {
      seen.push(scan.diskRows.length);
    });
    expect(seen).toEqual([0]); /* 磁盘行被活身份去重,不重复计 */
    expect(rows).toHaveLength(1);
    expect(rows[0].live).toBe(true);
    expect(rows[0].disk?.id).toBe("u-1");
    h.sessions = [];
    h.disk = [];
  });
});
