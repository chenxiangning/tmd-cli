/**
 * indexerTicks 时间盒排空契约(042 裁决②):
 * 缓存命中步在同一拍内连做直至 12ms 时间盒耗尽(下一拍 0ms 续排),真读步
 * 维持 60ms 间隔;prime 首拍,扫完/空索引停拍。indexerTick 导出为单测缝,
 * now 注入保确定性(不赌 wall clock);自调度循环只验「最终 settled」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INDEX_TIME_BOX_MS, indexerTick, startIndexerTicks, type TickState } from "./indexerTicks";
import type { SessionIndex, SessionIndexer } from "./indexer";

/** 计数桩索引器:total 步,每步回报 cached 位。 */
interface StubIndexer extends SessionIndexer {
  steps: number;
}

function makeIndexer(total: number, cached: boolean): StubIndexer {
  const stub = {
    index: {
      cwd: "/ws",
      entries: [],
      scanned: 0,
      total: 0,
      listFailed: 0,
      workspacesTotal: 1,
      scannedWorkspaces: 1,
      goneCwds: [],
    } satisfies SessionIndex,
    steps: 0,
    async prime() {
      this.index.total = total;
      return total;
    },
    async step() {
      this.steps += 1;
      this.index.scanned += 1;
      return { more: this.steps < total, cached };
    },
  };
  return stub as unknown as StubIndexer;
}

const unprimed = (): TickState => ({ primed: false });

describe("indexerTick 时间盒", () => {
  it("缓存命中步连做:1ms/步 × 12ms 盒 = 一拍恰 12 步,下一拍 0ms", async () => {
    const indexer = makeIndexer(100, true);
    const state = unprimed();
    expect(await indexerTick(indexer, state, () => undefined, () => undefined, () => 0)).toBe(60); // prime 拍
    expect(indexer.steps).toBe(0);
    let clock = 0;
    const delay = await indexerTick(indexer, state, () => undefined, () => undefined, () => {
      clock += 1; // 每步恰好查一次 now
      return clock;
    });
    expect(indexer.steps).toBe(INDEX_TIME_BOX_MS); // 一盒 12 步,未超盒
    expect(delay).toBe(0); // 缓存步:立即续排
  });

  it("真读步维持 60ms:首步即返回,不跨真读连做", async () => {
    const indexer = makeIndexer(100, false);
    const state = unprimed();
    await indexerTick(indexer, state, () => undefined, () => undefined, () => 0);
    expect(await indexerTick(indexer, state, () => undefined, () => undefined, () => 0)).toBe(60);
    expect(indexer.steps).toBe(1);
  });

  it("扫完自停:末步返回 -1 并 settled;空索引 prime 拍即 settled", async () => {
    const indexer = makeIndexer(3, true);
    const state = unprimed();
    const settled = vi.fn();
    await indexerTick(indexer, state, () => undefined, settled, () => 0);
    expect(await indexerTick(indexer, state, () => undefined, settled, () => 0)).toBe(-1);
    expect(indexer.steps).toBe(3);
    expect(settled).toHaveBeenCalledOnce();
    const empty = makeIndexer(0, true);
    expect(await indexerTick(empty, unprimed(), () => undefined, settled, () => 0)).toBe(-1);
    expect(settled).toHaveBeenCalledTimes(2);
  });
});

/* ── 自调度循环(node 环境无 window,stub 到 globalThis.setTimeout) ── */

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startIndexerTicks 自调度", () => {
  it("真读步 60ms 一拍逐推进;stop 即中止", async () => {
    const indexer = makeIndexer(100, false);
    const stop = startIndexerTicks(indexer, () => undefined, () => undefined, () => 0);
    await vi.advanceTimersByTimeAsync(60);
    expect(indexer.steps).toBe(0); // prime 拍
    await vi.advanceTimersByTimeAsync(60);
    expect(indexer.steps).toBe(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(indexer.steps).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(600);
    expect(indexer.steps).toBe(2); // 中止后不再推进
  });

  it("缓存步连做:一拍内扫完即 settled,不再续排", async () => {
    const indexer = makeIndexer(10, true);
    const settled = vi.fn();
    startIndexerTicks(indexer, () => undefined, settled, () => 0);
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(60); // 一盒内 10 步扫完
    expect(indexer.steps).toBe(10);
    expect(settled).toHaveBeenCalledOnce();
  });
});
