/**
 * checkpoints store 翻沿种子与 LRU 触碰契约(0.4.5 回落沿对称化)—— 自
 * store.test.ts 拆出(300 行铁则)。覆盖:refreshBatches 翻沿种子键(loading
 * 帧携带种子键旧清单不闪空帧/失败保留种子)、touchCkptKey recency 触碰防逐出。
 * 模块级单例,经 vi.resetModules + 动态 import 取全新实例(同 store.test 先例)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CkptBatch } from "@kernel/ipc";

const ipcMock = vi.hoisted(() => ({
  checkpointList: vi.fn(),
  checkpointBatchDiff: vi.fn(),
  checkpointAnchor: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type StoreModule = typeof import("./store");
let store: StoreModule;

const CWD = "/repo";
const CLI = "cli-1";
const TMD = "tmd-1";

function batch(id: string, turn: number): CkptBatch {
  return {
    id,
    index: turn,
    open: false,
    ts: turn,
    tsEnd: null,
    sessionId: CLI,
    prompt: "p",
    engine: "",
    model: "",
    thinking: "",
    state: "pending",
    doneReason: null,
    guardId: null,
    attribution: "git",
    files: [],
    marksRefs: [],
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  store = await import("./store");
});

describe("翻沿种子与 LRU 触碰(0.4.5 回落沿对称化)", () => {
  it("翻沿种子:新键起拉 loading 帧携带种子键旧清单,不闪空帧;落地后切真数据", async () => {
    ipcMock.checkpointList.mockResolvedValueOnce([batch("old-1", 1)]);
    await store.refreshBatches(CWD, CLI, TMD);

    /* 挂起中的首拉:loading 帧 batches 来自种子键 */
    let release: (v: CkptBatch[]) => void = () => undefined;
    ipcMock.checkpointList.mockReturnValueOnce(
      new Promise<CkptBatch[]>((r) => {
        release = r;
      }),
    );
    const inflight = store.refreshBatches(CWD, "cli-2", TMD, CLI);
    const mid = store.getCkptBatches(CWD, "cli-2");
    expect(mid.loading).toBe(true);
    expect(mid.batches.map((b) => b.id)).toEqual(["old-1"]);

    release([batch("new-1", 2)]);
    await inflight;
    const done = store.getCkptBatches(CWD, "cli-2");
    expect(done.loading).toBe(false);
    expect(done.batches.map((b) => b.id)).toEqual(["new-1"]);
  });

  it("翻沿种子:首拉失败保留种子清单 + error(与既有失败语义同款)", async () => {
    ipcMock.checkpointList.mockResolvedValueOnce([batch("old-1", 1)]);
    await store.refreshBatches(CWD, CLI, TMD);

    ipcMock.checkpointList.mockRejectedValueOnce("E_IO: boom");
    await store.refreshBatches(CWD, "cli-2", TMD, CLI);

    const st = store.getCkptBatches(CWD, "cli-2");
    expect(st.error).toContain("E_IO");
    expect(st.batches.map((b) => b.id)).toEqual(["old-1"]);
  });

  it("touchCkptKey:回落键读期间触碰免 LRU 逐出(未触碰的旧键被挤出)", async () => {
    ipcMock.checkpointList.mockResolvedValue([]);
    for (let i = 0; i < 32; i++)
      await store.refreshBatches(CWD, `k${i}`, undefined);
    expect(store.hasCkptEntry(CWD, "k0")).toBe(true);

    store.touchCkptKey(CWD, "k0"); // 回落键触碰 → 挪尾,k1 变最老
    await store.refreshBatches(CWD, "k32", undefined); // 第 33 键:挤出 k1

    expect(store.hasCkptEntry(CWD, "k0")).toBe(true);
    expect(store.hasCkptEntry(CWD, "k1")).toBe(false);
  });
});
