/**
 * footprint 补账契约测试:候选筛选(本月/去重/cwd 解析)、已记账跳过、
 * 批筛选(封口/会话/月份)、按月对账的并入数与幂等(重跑 0 补)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CkptBatch } from "@kernel/ipc";

const files = new Map<string, string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configDir: vi.fn(async () => "/cfg"),
    checkpointList: vi.fn(async () => []),
    fsReadFile: vi.fn(async (p: string) => {
      const hit = files.get(p);
      if (hit === undefined) throw new Error("missing");
      return hit;
    }),
    fsWriteFile: vi.fn(async (p: string, body: string) => {
      files.set(p, body);
    }),
  },
}));
vi.mock("@kernel/fsDirs", () => ({ ensureParentDir: vi.fn(async () => undefined) }));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [{ id: "w1", name: "tmd-cli", root: "/ws", createdAt: 0 }],
}));
vi.mock("./dataSource", () => ({ loadSessionRows: vi.fn(async () => ({ rows: [], failed: 0 })) }));

import { ipc } from "@kernel/ipc";
import { loadSessionRows } from "./dataSource";
import {
  activeDaysOf, candidatesFor, monthKeyOf, needsCheck, pickBatches, reconcileMonth, reconcileOnce, resetReconcileOnce,
} from "./backfill";
import { resetMonthCache } from "./rollup";
import { emptyMonth, type FootprintMonthFile } from "./types";
import type { DaySessionRow } from "./dataSource";

const mockIpc = vi.mocked(ipc, true);
const mockRows = vi.mocked(loadSessionRows);

/** 本地时区 ms(月份断言不赌 UTC)。 */
const localMs = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();

let seq = 0;
function batch(over: Partial<CkptBatch> = {}): CkptBatch {
  seq += 1;
  return {
    id: `b${seq}`, index: 1, open: false, ts: localMs(2026, 10, 20), tsEnd: localMs(2026, 10, 20),
    sessionId: "s1", prompt: "", engine: "omp", model: "", thinking: "",
    state: "done", doneReason: null, guardId: null, files: [], attribution: "events", marksRefs: [],
    ...over,
  };
}

function row(over: Partial<DaySessionRow> = {}): DaySessionRow {
  return {
    profileId: "omp", title: "t", id: "s1", startedAt: localMs(2026, 10, 20),
    modifiedAt: localMs(2026, 10, 20), live: false, wsName: "tmd-cli", wsId: "w1", ...over,
  };
}

const rootOf = (id?: string) => (id === "w1" ? "/ws" : null);

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  resetMonthCache();
});

describe("monthKeyOf", () => {
  it("本地月键两位补零", () => {
    expect(monthKeyOf(localMs(2026, 1, 5))).toBe("2026-01");
    expect(monthKeyOf(localMs(2026, 10, 20))).toBe("2026-10");
  });
});

describe("candidatesFor(候选会话)", () => {
  it("本月活动命中;跨月弃;cwd 解析不出弃;同 id 只留一次", () => {
    const rows = [
      row({ id: "a", startedAt: localMs(2026, 10, 1), modifiedAt: localMs(2026, 10, 1) }),
      row({ id: "a", startedAt: localMs(2026, 10, 2), modifiedAt: localMs(2026, 10, 2) }), // 重复行 → 活动日并集
      row({ id: "b", startedAt: localMs(2026, 9, 30), modifiedAt: localMs(2026, 10, 1) }), // 跨月续聊
      row({ id: "c", startedAt: localMs(2026, 9, 1), modifiedAt: localMs(2026, 9, 2) }), // 纯上月
      row({ id: "d", startedAt: localMs(2026, 10, 3), wsId: "gone" }), // 工作区已删
      row({ id: undefined, startedAt: localMs(2026, 10, 3) }), // 无会话 id
    ];
    expect(candidatesFor(rows, rootOf, "2026-10")).toEqual([
      { sid: "a", cwd: "/ws", days: ["01", "02"] },
      { sid: "b", cwd: "/ws", days: ["01"] }, // 9/30 裁掉,只留本月
    ]);
  });
});

describe("activeDaysOf(本月活动日)", () => {
  it("跨零点区间取两端日;跨月裁进本月", () => {
    expect(activeDaysOf(localMs(2026, 10, 19, 23), localMs(2026, 10, 20, 1), "2026-10")).toEqual(["19", "20"]);
    expect(activeDaysOf(localMs(2026, 9, 30), localMs(2026, 10, 1), "2026-10")).toEqual(["01"]);
  });

  it("两端倒挂也按区间取(磁盘行 createdAt 可能晚于 modifiedAt)", () => {
    expect(activeDaysOf(localMs(2026, 10, 20, 9), localMs(2026, 10, 18, 9), "2026-10")).toEqual(["18", "19", "20"]);
  });
});

describe("needsCheck(逐日缺口判定)", () => {
  const withSession = (sid: string, dd: string): FootprintMonthFile => {
    const m = emptyMonth();
    m.days[dd] = { sessions: { [sid]: { engine: "omp", cwd: "/ws", turns: [1], first: "", last: "" } }, files: {}, batches: {} };
    return m;
  };

  it("活动日全在账 → 不查;任一日缺 → 查", () => {
    expect(needsCheck(withSession("s1", "20"), { sid: "s1", cwd: "/ws", days: ["20"] })).toBe(false);
    expect(needsCheck(emptyMonth(), { sid: "s1", cwd: "/ws", days: ["20"] })).toBe(true);
  });

  it("跨零点会话只在 19 日入账 → 20 日仍判缺口(不被「已在别的日出现」跳过)", () => {
    const m = withSession("s1", "19");
    expect(needsCheck(m, { sid: "s1", cwd: "/ws", days: ["19", "20"] })).toBe(true);
  });
});

describe("pickBatches(可补批筛选)", () => {
  it("只留已封口 + 会话匹配 + 本月封口", () => {
    const list = [
      batch({ id: "ok" }),
      batch({ id: "open", open: true }),
      batch({ id: "other", sessionId: "s9" }),
      batch({ id: "lastMonth", ts: localMs(2026, 9, 30), tsEnd: localMs(2026, 9, 30) }),
    ];
    expect(pickBatches(list, "s1", "2026-10").map((b) => b.id)).toEqual(["ok"]);
  });

  it("tsEnd 缺省回落 ts 判月(未封口末端时刻)", () => {
    const b = batch({ id: "noEnd", tsEnd: null, ts: localMs(2026, 10, 2) });
    expect(pickBatches([b], "s1", "2026-10")).toHaveLength(1);
  });
});

describe("reconcileMonth(按月补账)", () => {
  it("账上无该会话 → 补入本月封口批;重跑幂等 0 补", async () => {
    mockRows.mockResolvedValue({ rows: [row({ id: "s1" })], failed: 0 });
    mockIpc.checkpointList.mockResolvedValue([
      batch({ id: "b-new", index: 1, files: [{ path: "/ws/a.ts", status: "M", reverted: false, live: "same", stale: false, editCount: 1, additions: 7, deletions: 2, noBaseline: false }] }),
      batch({ id: "b-last", index: 2, ts: localMs(2026, 9, 30), tsEnd: localMs(2026, 9, 30) }),
    ]);

    expect(await reconcileMonth("2026-10")).toBe(1);
    const written = JSON.parse([...files.values()][0]) as FootprintMonthFile;
    expect(written.days["20"].sessions["s1"].turns).toEqual([1]);
    expect(written.days["20"].files["/ws/a.ts"]).toMatchObject({ add: 7, del: 2, refs: ["s1"] });

    resetMonthCache(); // 丢掉内存缓存,从落盘档重读:幂等由轮次号 + 已记账共同保证
    mockIpc.checkpointList.mockClear();
    expect(await reconcileMonth("2026-10")).toBe(0);
    expect(mockIpc.checkpointList).not.toHaveBeenCalled();
  });

  it("账上已有该会话 → 不发账本查询(交给封口事件续)", async () => {
    const m = emptyMonth();
    m.days["20"] = { sessions: { s1: { engine: "omp", cwd: "/ws", turns: [1], first: "", last: "" } }, files: {}, batches: {} };
    files.set("/cfg/footprint/2026-10.json", JSON.stringify(m));
    mockRows.mockResolvedValue({ rows: [row({ id: "s1" })], failed: 0 });

    expect(await reconcileMonth("2026-10")).toBe(0);
    expect(mockIpc.checkpointList).not.toHaveBeenCalled();
  });

  it("单会话读账失败 → 跳过该会话,其它会话照补", async () => {
    mockRows.mockResolvedValue({ rows: [row({ id: "bad" }), row({ id: "good" })], failed: 0 });
    mockIpc.checkpointList.mockImplementation(async (_cwd: string, sid: string) => {
      if (sid === "bad") throw new Error("no ledger");
      return [batch({ id: "gb", sessionId: "good" })];
    });

    expect(await reconcileMonth("2026-10")).toBe(1);
    const written = JSON.parse([...files.values()][0]) as FootprintMonthFile;
    expect(Object.keys(written.days["20"].sessions)).toEqual(["good"]);
  });

  it("并发补账走单飞队列,不互相覆写(两会话同时补,落盘含两者)", async () => {
    mockIpc.checkpointList.mockImplementation(async (_cwd: string, sid: string) => [batch({ id: `b-${sid}`, sessionId: sid })]);
    mockRows.mockResolvedValueOnce({ rows: [row({ id: "s1" })], failed: 0 });
    const [a, b] = await Promise.all([reconcileMonth("2026-10"), (async () => {
      mockRows.mockResolvedValueOnce({ rows: [row({ id: "s2" })], failed: 0 });
      return reconcileMonth("2026-10");
    })()]);

    expect(a + b).toBe(2);
    const written = JSON.parse([...files.values()].pop() as string) as FootprintMonthFile;
    expect(Object.keys(written.days["20"].sessions).sort()).toEqual(["s1", "s2"]);
  });
});

describe("reconcileOnce(视图侧单次闸)", () => {
  it("首次调补齐并 bump;重复调不再扫(进程内只对账一次)", async () => {
    resetReconcileOnce();
    mockRows.mockResolvedValue({ rows: [row({ id: "s1" })], failed: 0 });
    mockIpc.checkpointList.mockResolvedValue([batch({ id: "b1" })]);

    expect(await reconcileOnce()).toBe(1);
    mockIpc.checkpointList.mockClear();
    mockRows.mockClear();
    expect(await reconcileOnce()).toBe(0);
    expect(mockRows).not.toHaveBeenCalled();
    expect(mockIpc.checkpointList).not.toHaveBeenCalled();
  });

  it("对账抛错不外抛(视图挂载不被补账拖挂),闸已置位不重试", async () => {
    resetReconcileOnce();
    mockRows.mockRejectedValue(new Error("scan boom"));
    await expect(reconcileOnce()).resolves.toBe(0);
    mockRows.mockClear();
    await reconcileOnce();
    expect(mockRows).not.toHaveBeenCalled();
  });
});
