/** footprint 写侧单测:归日跨零点 / 并发封口串行 / isCfgPath 边界 / files 聚合累加 / 月缓存命中。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KernelTopics, type CkptTurnSealedEvent } from "@kernel/events";
import type { CkptBatch } from "@kernel/ipc";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configDir: vi.fn(async () => "/cfg"),
    checkpointList: vi.fn(async () => []),
    fsReadFile: vi.fn(async () => {
      throw new Error("missing");
    }),
    fsWriteFile: vi.fn(async () => undefined),
  },
}));
vi.mock("@kernel/fsDirs", () => ({ ensureParentDir: vi.fn(async () => undefined) }));

import { ipc } from "@kernel/ipc";
import {
  activateRollup, getMonth, mergeBatchIntoDay, resetMonthCache, rollupIdle,
} from "./rollup";
import { emptyDay, isCfgPath } from "./types";

const mockIpc = vi.mocked(ipc, true);

/** 测试桩事件总线:捕获订阅 handler,手动 emit。 */
function fakeBus() {
  const handlers = new Map<string, (p: unknown) => void>();
  return {
    on: (topic: string, h: (p: unknown) => void) => {
      handlers.set(topic, h);
      return () => handlers.delete(topic);
    },
    emit: (topic: string, p: unknown) => handlers.get(topic)?.(p),
  };
}

let seq = 0;
function batch(over: Partial<CkptBatch> = {}): CkptBatch {
  seq += 1;
  return {
    id: `b${seq}`, index: 1, open: false, ts: Date.now(), tsEnd: null,
    sessionId: "s1", prompt: "", engine: "omp", model: "", thinking: "",
    state: "done", doneReason: null, guardId: null, files: [],
    attribution: "events", marksRefs: [],
    ...over,
  };
}

function file(path: string, additions: number, deletions: number): CkptBatch["files"][number] {
  return { path, status: "M", reverted: false, live: "same", stale: false, editCount: 1, additions, deletions, noBaseline: false };
}

function sealedEvent(over: Partial<CkptTurnSealedEvent> = {}): CkptTurnSealedEvent {
  return { cwd: "/ws", sessionId: "s1", tmdSessionId: "t1", ...over };
}

/** 本地时区构造 ms(跨零点用例不赌 UTC)。 */
const localMs = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();

async function lastWritten(): Promise<{ days: Record<string, unknown> }> {
  const calls = mockIpc.fsWriteFile.mock.calls;
  const last = calls[calls.length - 1];
  expect(last).toBeDefined();
  return JSON.parse(last[1]) as { days: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMonthCache();
  mockIpc.fsReadFile.mockRejectedValue(new Error("missing"));
});

describe("isCfgPath", () => {
  it("扩展名大小写不敏感且覆盖清单", () => {
    for (const p of ["a.yml", "b.YAML", "c.Json", "d.TOML", "e.ini", "f.CONF", "g.Env", "h.properties", "i.xml", "j.sql"])
      expect(isCfgPath(p)).toBe(true);
  });

  it("非配置与无扩展名为 false", () => {
    for (const p of ["a.ts", "b.md", "c", "d.rs", "e.ymlx", "dir.jsonx/readme"])
      expect(isCfgPath(p)).toBe(false);
  });
});

describe("归日", () => {
  it("tsEnd 跨零点归 tsEnd 日(ts 3-14 23:59 / tsEnd 3-15 00:10 → 15 日)", async () => {
    mockIpc.checkpointList.mockResolvedValue([
      batch({ ts: localMs(2026, 3, 14, 23, 59), tsEnd: localMs(2026, 3, 15, 0, 10), files: [
        file("src/a.ts", 10, 2),
      ] }),
    ]);
    const bus = fakeBus();
    const off = activateRollup(bus as never);
    bus.emit(KernelTopics.ckptTurnSealed, sealedEvent());
    await rollupIdle();
    off();

    const written = await lastWritten();
    expect(Object.keys(written.days)).toEqual(["15"]);
  });
});

describe("并发封口", () => {
  it("两事件串行消费,同一文件聚合累加且批次取最新", async () => {
    const b1 = batch({ id: "b1", index: 1, ts: localMs(2026, 3, 15, 0, 30), files: [file("src/a.ts", 3, 1)] });
    const b2 = batch({ id: "b2", sessionId: "s2", index: 2, ts: localMs(2026, 3, 15, 1, 0), files: [file("src/a.ts", 5, 0)] });
    mockIpc.checkpointList.mockImplementation(async (_cwd, sid) => (sid === "s1" ? [b1] : [b2]));

    const bus = fakeBus();
    const off = activateRollup(bus as never);
    bus.emit(KernelTopics.ckptTurnSealed, sealedEvent({ sessionId: "s1" }));
    bus.emit(KernelTopics.ckptTurnSealed, sealedEvent({ sessionId: "s2" }));
    await rollupIdle();
    off();

    interface WrittenDay { files: Record<string, { add: number; del: number; refs: string[] }>; batches: Record<string, string> }
    const days = (await lastWritten()).days as Record<string, WrittenDay>;
    const written = days["15"];
    expect(written.files["src/a.ts"]).toMatchObject({ add: 8, del: 1 });
    expect(written.files["src/a.ts"].refs).toEqual(["s1", "s2"]);
    expect(written.batches).toEqual({ s1: "b1", s2: "b2" });
  });

  it("open 批与会话不匹配的批不收", async () => {
    mockIpc.checkpointList.mockResolvedValue([
      batch({ open: true }),
      batch({ sessionId: "other" }),
    ]);
    const bus = fakeBus();
    const off = activateRollup(bus as never);
    bus.emit(KernelTopics.ckptTurnSealed, sealedEvent());
    await rollupIdle();
    off();
    expect(mockIpc.fsWriteFile).not.toHaveBeenCalled();
  });
});

describe("mergeBatchIntoDay(纯函数)", () => {
  it("files 累加、cfg 打标、turns 追加、first/last 取两端", () => {
    const day = emptyDay();
    const t1 = localMs(2026, 3, 15, 9, 0);
    mergeBatchIntoDay(day, batch({ sessionId: "s1", index: 1, ts: t1, tsEnd: t1 + 60_000, engine: "omp", files: [
      file("cfg/app.json", 4, 1),
      file("src/x.ts", 2, 7),
    ] }), "/ws");
    mergeBatchIntoDay(day, batch({ sessionId: "s1", index: 5, ts: t1 - 3_600_000, tsEnd: t1 + 120_000, files: [
      file("src/x.ts", 1, 1),
    ] }), "/ws");

    expect(day.files["cfg/app.json"]).toMatchObject({ add: 4, del: 1, cfg: true });
    expect(day.files["src/x.ts"]).toMatchObject({ add: 3, del: 8, cfg: false });
    expect(day.files["src/x.ts"].refs).toEqual(["s1"]);
    const sess = day.sessions.s1;
    expect(sess.turns).toEqual([1, 5]);
    expect(sess.engine).toBe("omp");
    expect(new Date(sess.first).getTime()).toBe(t1 - 3_600_000);
    expect(new Date(sess.last).getTime()).toBe(t1 + 120_000);
  });
});

describe("月缓存", () => {
  it("第二次 getMonth 命中缓存不再读盘,写入后缓存可见", async () => {
    await getMonth("2026-05");
    expect(mockIpc.fsReadFile).toHaveBeenCalledTimes(1);
    await getMonth("2026-05");
    expect(mockIpc.fsReadFile).toHaveBeenCalledTimes(1);
  });

  it("LRU 3:第 4 个月挤掉最旧,再读重落盘", async () => {
    for (const ym of ["2026-01", "2026-02", "2026-03"]) await getMonth(ym);
    expect(mockIpc.fsReadFile).toHaveBeenCalledTimes(3);
    await getMonth("2026-04");
    expect(mockIpc.fsReadFile).toHaveBeenCalledTimes(4);
    await getMonth("2026-01"); /* 最旧已被逐出 → 重读 */
    expect(mockIpc.fsReadFile).toHaveBeenCalledTimes(5);
    await getMonth("2026-04"); /* 仍在缓存 */
    expect(mockIpc.fsReadFile).toHaveBeenCalledTimes(5);
  });
});
