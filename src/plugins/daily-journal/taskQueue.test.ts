/** 任务队列测试(入队去重/单并发泵/取消/恢复改判;runner 注入桩,零真实定时器)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QTask {
  id: number;
  st: string;
  dayKey: string;
  type: string;
  text: string;
}

interface QueueModule {
  enqueueTask: (type: "手动生成", dayKey: string, engine: string) => { id: number } | null;
  setTaskRunner: (fn: (task: { id: number }) => Promise<void>) => void;
  finishTask: (id: number, ok: boolean, text: string) => void;
  cancelTask: (id: number) => boolean;
  restoreTasks: (saved: unknown) => void;
  getGenTasks: () => readonly QTask[];
  bindTaskPersistence: (fn: (tasks: unknown[]) => void) => void;
}

let q: QueueModule;
let persisted: unknown[][] = [];

/** 单发闸:runner 挂起等放行(withResolvers,零定时器)。 */
function makeGate(): { promise: Promise<void>; open: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: resolve };
}

beforeEach(async () => {
  vi.resetModules();
  persisted = [];
  q = (await import("./taskQueue")) as unknown as QueueModule;
  q.bindTaskPersistence((tasks) => persisted.push(tasks));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("taskQueue", () => {
  it("入队即泵单并发;finishTask 后队列接续", () => {
    const gate = makeGate();
    const started: number[] = [];
    q.setTaskRunner((task) => {
      started.push(task.id);
      return gate.promise;
    });
    const a = q.enqueueTask("手动生成", "2026-09-27", "omp");
    const b = q.enqueueTask("手动生成", "2026-09-26", "omp");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(started).toEqual([a!.id]); /* 只跑队首,后者排队 */
    gate.open();
    q.finishTask(a!.id, true, "已完成");
    expect(started).toEqual([a!.id, b!.id]); /* 终态推进下一发 */
  });

  it("同日同类型活跃去重", () => {
    q.setTaskRunner(() => makeGate().promise);
    const first = q.enqueueTask("手动生成", "2026-09-27", "omp");
    expect(q.enqueueTask("手动生成", "2026-09-27", "omp")).toBeNull();
    expect(q.getGenTasks().filter((t) => t.dayKey === "2026-09-27")).toHaveLength(1);
    expect(first).not.toBeNull();
  });

  it("取消仅排队可取消", () => {
    const gate = makeGate();
    q.setTaskRunner(() => gate.promise);
    const a = q.enqueueTask("手动生成", "2026-09-27", "omp")!;
    const b = q.enqueueTask("手动生成", "2026-09-26", "omp")!;
    expect(q.cancelTask(b.id)).toBe(true);
    expect(q.cancelTask(a.id)).toBe(false); /* run 态不可取消 */
    gate.open();
    q.finishTask(a.id, true, "已完成");
  });

  it("恢复:run 改判中断,queue 保留并续跑", () => {
    const run = vi.fn(() => Promise.resolve());
    q.setTaskRunner(run);
    q.restoreTasks([
      { id: 5, dayKey: "2026-09-27", type: "定时生成", engine: "omp", st: "run", text: "生成中", since: 1, sessionId: "pty-1" },
      { id: 6, dayKey: "2026-09-26", type: "手动生成", engine: "omp", st: "queue", text: "排队中", since: 2 },
    ]);
    const tasks = q.getGenTasks();
    expect(tasks.find((t) => t.id === 5)?.st).toBe("err");
    expect(tasks.find((t) => t.id === 5)?.text).toContain("中断");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 6 })); /* 排队续跑:恢复即泵成 run */
    /* id 回退:恢复后新任务 id 不与既有冲突。 */
    const next = q.enqueueTask("手动生成", "2026-09-25", "omp");
    expect(next?.id).toBeGreaterThan(6);
  });

  it("任务史经持久化通道外流", () => {
    q.setTaskRunner(() => Promise.resolve());
    q.enqueueTask("手动生成", "2026-09-27", "omp");
    expect(persisted.length).toBeGreaterThan(0);
    expect(JSON.stringify(persisted.at(-1))).toContain("2026-09-27");
  });
});
