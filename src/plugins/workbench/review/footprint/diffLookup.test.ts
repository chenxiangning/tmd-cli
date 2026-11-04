/** diffLookup:首选批未中 → 账本枚举兜底;绝对路径拼装(2026-10-20 两案回归锚)。 */
import { describe, expect, it, vi } from "vitest";
import { absFilePath, fileBatch, loadPatchForFile } from "./diffLookup";
import type { CkptBatch, CkptPatch } from "@kernel/ipc";
import type { FootprintDay } from "./types";

const batchDiff = vi.fn<(cwd: string, batchId: string) => Promise<CkptPatch[]>>();
const listBatches = vi.fn<(cwd: string, sid: string) => Promise<CkptBatch[]>>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    checkpointBatchDiff: (cwd: string, batchId: string) => batchDiff(cwd, batchId),
    checkpointList: (cwd: string, sid: string) => listBatches(cwd, sid),
  },
}));

const patch = (path: string): CkptPatch => ({ path, kind: "M", additions: 1, deletions: 0, patch: `--- a/${path}`, binary: false });

/** diffLookup 只消费 id/open/files[].path,夹具最小化。 */
const batch = (id: string, open: boolean, paths: string[]): CkptBatch =>
  ({ id, open, files: paths.map((path) => ({ path })) }) as unknown as CkptBatch;

const day: FootprintDay = {
  sessions: { s1: { engine: "omp", cwd: "/ws", turns: [1, 2], first: "", last: "" } },
  files: {},
  batches: { s1: "b2" },
};

describe("fileBatch", () => {
  it("无 rollup / 无 cwd 会话 = null", () => {
    expect(fileBatch(null, ["s1"])).toBeNull();
    expect(fileBatch(day, ["ghost"])).toBeNull();
  });

  it("cwd 取首 ref 会话,batchId 取 rollup 最近批(可为 null)", () => {
    expect(fileBatch(day, ["s1"])).toEqual({ cwd: "/ws", batchId: "b2", sids: ["s1"] });
    expect(fileBatch({ ...day, batches: {} }, ["s1"])?.batchId).toBeNull();
  });
});

describe("loadPatchForFile", () => {
  it("首选批命中:不查账本", async () => {
    batchDiff.mockResolvedValue([patch("a.ts")]);
    const out = await loadPatchForFile("/ws", "b2", ["s1"], "a.ts");
    expect(out?.path).toBe("a.ts");
    expect(batchDiff).toHaveBeenCalledWith("/ws", "b2");
    expect(listBatches).not.toHaveBeenCalled();
  });

  it("首选批未中(文件属早前轮):枚举账本取含该路径的最近封口批,open 批跳过", async () => {
    batchDiff.mockImplementation((_cwd, bid) =>
      Promise.resolve(bid === "b1" ? [patch("a.ts")] : [patch("other.ts")]),
    );
    listBatches.mockResolvedValue([batch("b1", false, ["a.ts"]), batch("b2n", true, ["a.ts"])]);
    const out = await loadPatchForFile("/ws", "b2", ["s1"], "a.ts");
    expect(out?.path).toBe("a.ts");
    expect(batchDiff).toHaveBeenCalledWith("/ws", "b1");
  });

  it("账本不存在/已清理:null(调用方降级)", async () => {
    batchDiff.mockResolvedValue([]);
    listBatches.mockRejectedValue(new Error("批次不存在"));
    expect(await loadPatchForFile("/ws", "b2", ["s1"], "a.ts")).toBeNull();
  });
});

describe("absFilePath", () => {
  it("首 ref 会话 cwd 拼 POSIX 绝对路径;无 cwd 回落原样", () => {
    expect(absFilePath(day, ["s1"], "src/a.ts")).toBe("/ws/src/a.ts");
    expect(absFilePath(day, ["ghost"], "src/a.ts")).toBe("src/a.ts");
  });
});
