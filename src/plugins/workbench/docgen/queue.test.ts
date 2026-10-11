/** docgen 队列测试(维度键去重/3 槽泵/取消/恢复改判;runner 注入桩,零真实定时器)。
 *  动态 import 为模块加载边界测试所需:vi.resetModules 后必须重新 import 才能拿到重置后的单例(journal taskQueue.test 同款)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./store", () => ({ persistQueueTasks: vi.fn(), failEntry: vi.fn(async () => undefined) }));

interface QTask {
  id: number;
  st: string;
  entryId: string;
  dimensionKey: string;
  text: string;
  sessionId?: string;
}

interface QueueModule {
  enqueueDocGenTask: (type: string, entryId: string, dimensionKey: string, engine: string) => { id: number } | null;
  setDocGenRunner: (fn: ((task: { id: number }) => Promise<void>) | null, abort?: (task: { id: number; sessionId?: string }) => void) => void;
  finishDocGenTask: (id: number, ok: boolean, text: string) => void;
  startDocGenTaskRun: (id: number, sessionId: string, text: string) => void;
  cancelDocGenTask: (id: number) => boolean;
  restoreDocGenTasks: (saved: unknown) => void;
  getDocGenTasks: () => readonly QTask[];
  noteDocGenTask: (id: number, text: string) => void;
}

let q: QueueModule;

function makeGate(): { promise: Promise<void>; open: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: resolve };
}

beforeEach(async () => {
  vi.resetModules();
  q = (await import("./queue")) as unknown as QueueModule;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("docgen queue", () => {
  it("3 槽并发即起;满槽排队,终态补位", () => {
    const gate = makeGate();
    const started: number[] = [];
    q.setDocGenRunner((task) => {
      started.push(task.id);
      return gate.promise;
    });
    const ids = ["a", "b", "c", "d"].map((k) => q.enqueueDocGenTask("手动生成", `dg-${k}`, `weekly|all|${k}`, "omp")!.id);
    expect(started).toEqual([ids[0], ids[1], ids[2]]);
    gate.open();
    q.finishDocGenTask(ids[0], true, "已落盘 v1");
    expect(started).toEqual([ids[0], ids[1], ids[2], ids[3]]);
  });

  it("同维度键活跃去重;不同维度不受影响", () => {
    q.setDocGenRunner(() => makeGate().promise);
    expect(q.enqueueDocGenTask("手动生成", "dg-1", "weekly|all|2026-W41", "omp")).not.toBeNull();
    expect(q.enqueueDocGenTask("重试生成", "dg-1", "weekly|all|2026-W41", "omp")).toBeNull();
    expect(q.enqueueDocGenTask("手动生成", "dg-2", "weekly|all|2026-W40", "omp")).not.toBeNull();
  });

  it("run 态取消:收割体被调,任务判失败", () => {
    const aborted: number[] = [];
    q.setDocGenRunner(() => makeGate().promise, (task) => aborted.push(task.id));
    const task = q.enqueueDocGenTask("手动生成", "dg-1", "k1", "omp")!;
    expect(q.cancelDocGenTask(task.id)).toBe(true);
    expect(aborted).toEqual([task.id]);
    const stored = q.getDocGenTasks().find((x) => x.id === task.id)!;
    expect(stored.st).toBe("err");
    expect(stored.text).toContain("已取消");
  });

  it("排队态取消:不经收割体", () => {
    const aborted: number[] = [];
    const gate = makeGate();
    q.setDocGenRunner(() => gate.promise, (task) => aborted.push(task.id));
    q.enqueueDocGenTask("手动生成", "dg-1", "k1", "omp");
    q.enqueueDocGenTask("手动生成", "dg-2", "k2", "omp");
    q.enqueueDocGenTask("手动生成", "dg-3", "k3", "omp");
    const queued = q.enqueueDocGenTask("手动生成", "dg-4", "k4", "omp")!;
    expect(q.getDocGenTasks().find((x) => x.id === queued.id)!.st).toBe("queue");
    expect(q.cancelDocGenTask(queued.id)).toBe(true);
    expect(aborted).toEqual([]);
  });

  it("启动恢复:run 改判中断并收割 entry,queue 保留续跑,id 序号推进", async () => {
    const gate = makeGate();
    const started: number[] = [];
    q.setDocGenRunner((task) => {
      started.push(task.id);
      return gate.promise;
    });
    q.restoreDocGenTasks([
      { id: 7, entryId: "dg-a", dimensionKey: "k7", type: "排程生成", engine: "omp", st: "run", text: "生成中" },
      { id: 8, entryId: "dg-b", dimensionKey: "k8", type: "手动生成", engine: "omp", st: "queue", text: "排队中" },
    ]);
    expect(q.getDocGenTasks().find((x) => x.id === 7)!.text).toBe("中断(应用重启)");
    /* 动态 import:vi.resetModules 边界测试,须取重置后的 mock 实例(文件头注释)。 */
    const { failEntry } = await import("./store");
    expect(failEntry).toHaveBeenCalledWith("dg-a", "中断(应用重启)");
    expect(started).toContain(8);
    const fresh = q.enqueueDocGenTask("手动生成", "dg-c", "k9", "omp")!;
    expect(fresh.id).toBeGreaterThan(8);
  });

  it("noteTask 只更新 run 态文案", () => {
    q.setDocGenRunner(() => makeGate().promise);
    const task = q.enqueueDocGenTask("手动生成", "dg-1", "k1", "omp")!;
    q.noteDocGenTask(task.id, "已检测到文档写入,结算中…");
    expect(q.getDocGenTasks().find((x) => x.id === task.id)!.text).toContain("结算中");
  });
});
