/**
 * 转录导出 UI 面纯逻辑契约(帽 50 截断/串行批量失败聚合与取消/快照菜单装配);
 * 落盘内核 mock(@plugins/session-viewer/exportMd,仿 log.test.ts 先例)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const exportMdTo = vi.hoisted(() => vi.fn());
const snapshotMdTo = vi.hoisted(() => vi.fn());
const pickDirectory = vi.hoisted(() => vi.fn());
vi.mock("@plugins/session-viewer/exportMd", () => ({ exportMdTo, snapshotMdTo }));
vi.mock("@kernel/ipc", () => ({
  ipc: {},
  pickDirectory,
  pickSavePath: vi.fn(),
}));

import {
  BATCH_EXPORT_CAP,
  exportSessionsBatch,
  planBatchExport,
  snapshotMenuHandler,
  type BatchExportItem,
} from "./transcriptExportRun";
import type { ExportSessionTarget } from "@plugins/session-viewer/exportMd";

const item = (id: string): BatchExportItem => ({
  key: id,
  label: id,
  target: { cliSessionId: id, profileId: "claude", path: `/tmp/${id}.jsonl` },
});

beforeEach(() => {
  exportMdTo.mockReset();
  pickDirectory.mockReset();
});

describe("planBatchExport(帽 50 拒开跑)", () => {
  it("超限 → blocked(不开跑,提示分批;不截断)", () => {
    const blocked = planBatchExport(Array.from({ length: BATCH_EXPORT_CAP + 1 }, (_, i) => item(`s${i}`)));
    expect(blocked).toEqual({ blocked: "over-cap", count: BATCH_EXPORT_CAP + 1 });
  });

  it("未超限 → 原样放行", () => {
    const ok = planBatchExport([item("a"), item("b")]);
    if (!("items" in ok)) throw new Error("expected items");
    expect(ok.items.map((i) => i.key)).toEqual(["a", "b"]);
  });
});

describe("exportSessionsBatch(串行/失败聚合/取消/中止)", () => {
  it("逐个落盘:进度 0..N 全量上报,skip 类失败按 reason 归类不中止", async () => {
    exportMdTo.mockImplementation((_dir: string, target: ExportSessionTarget) =>
      target.cliSessionId === "bad" ? Promise.resolve({ ok: false, reason: "no-adapter" }) : Promise.resolve({ ok: true, fileName: "x.md" }),
    );
    const progress: Array<[number, number]> = [];
    const out = await exportSessionsBatch([item("a"), item("bad"), item("c")], "/out", {
      isCancelled: () => false,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(out).toEqual({
      written: 2,
      cancelled: false,
      aborted: null,
      failures: [{ label: "bad", reason: "no-adapter" }],
    });
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    /* 串行纪律:同批共享 taken 集合传给每一次落盘。 */
    expect(exportMdTo).toHaveBeenCalledTimes(3);
    expect(exportMdTo.mock.calls[0][2]).toBe(exportMdTo.mock.calls[2][2]);
  });

  it("write-failed 即中止:已写留存,剩余未导,中止项归 head 不入失败列", async () => {
    exportMdTo.mockImplementation((_dir: string, target: ExportSessionTarget) =>
      target.cliSessionId === "c" ? Promise.resolve({ ok: false, reason: "write-failed" }) : Promise.resolve({ ok: true, fileName: "x.md" }),
    );
    const out = await exportSessionsBatch([item("a"), item("b"), item("c"), item("d")], "/out", {
      isCancelled: () => false,
      onProgress: () => undefined,
    });
    expect(out).toEqual({ written: 2, cancelled: false, aborted: "c", failures: [] });
    /* 中止点之后的 d 不再尝试(整批停)。 */
    expect(exportMdTo).toHaveBeenCalledTimes(3);
  });

  it("取消 = 停在当前:已完成保留,后续不再读", async () => {
    let done = 0;
    let cancelAfterFirst = false;
    exportMdTo.mockImplementation(() => {
      done += 1;
      if (done === 1) cancelAfterFirst = true;
      return Promise.resolve({ ok: true, fileName: "x.md" });
    });
    const out = await exportSessionsBatch([item("a"), item("b"), item("c")], "/out", {
      isCancelled: () => cancelAfterFirst,
      onProgress: () => undefined,
    });
    expect(out).toEqual({ written: 1, cancelled: true, aborted: null, failures: [] });
    expect(exportMdTo).toHaveBeenCalledTimes(1);
  });
});

describe("snapshotMenuHandler(活会话快照菜单装配)", () => {
  const meta = { id: "live-1", profileId: "claude", cwd: "/ws" };

  it("无磁盘绑定 → undefined(菜单项隐藏)", () => {
    expect(snapshotMenuHandler(vi.fn(), meta, undefined, "t", "claude", "/ws")).toBeUndefined();
  });

  it("ssh / shell 会话 → undefined", () => {
    expect(snapshotMenuHandler(vi.fn(), { ...meta, kind: "ssh" }, "c1", "t", "claude", "/ws")).toBeUndefined();
    expect(snapshotMenuHandler(vi.fn(), { ...meta, kind: "shell" }, "c1", "t", "claude", "/ws")).toBeUndefined();
  });

  it("有磁盘绑定的 cli 会话 → 绑定 run 并携带 target", () => {
    const run = vi.fn();
    const handler = snapshotMenuHandler(run, meta, "c1", "标题", "claude", "/ws");
    expect(handler).toBeTypeOf("function");
    handler?.();
    expect(run).toHaveBeenCalledWith({ cliSessionId: "c1", title: "标题", profileId: "claude", cwd: "/ws" });
  });
});
