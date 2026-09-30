/** 任务队列测试(入队去重/3 槽并发泵/取消/恢复改判;runner 注入桩,零真实定时器)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QTask {
  id: number;
  st: string;
  dayKey: string;
  type: string;
  text: string;
  sessionId?: string;
}

interface QueueModule {
  enqueueTask: (type: string, dayKey: string, engine: string) => { id: number } | null;
  setTaskRunner: (
    fn: ((task: { id: number }) => Promise<void>) | null,
    abort?: (task: { id: number; sessionId?: string }) => void,
  ) => void;
  finishTask: (id: number, ok: boolean, text: string) => void;
  startTaskRun: (id: number, sessionId: string, text: string) => void;
  cancelTask: (id: number) => boolean;
  restoreTasks: (saved: unknown) => void;
  getGenTasks: () => readonly QTask[];
  bindTaskPersistence: (fn: (tasks: unknown[]) => void) => void;
  dayGenTaskType: (failed: boolean, hasArticle: boolean) => string;
  hasActiveTaskForDay: (dayKey: string) => boolean;
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
  it("入队即泵 3 槽并发;满槽排队,finishTask 后补位", () => {
    const gate = makeGate();
    const started: number[] = [];
    q.setTaskRunner((task) => {
      started.push(task.id);
      return gate.promise;
    });
    const ids = ["27", "26", "25", "24"].map((d) => q.enqueueTask("手动生成", `2026-09-${d}`, "omp")!.id);
    expect(started).toEqual([ids[0], ids[1], ids[2]]); /* 3 槽即起,末位排队 */
    gate.open();
    q.finishTask(ids[0], true, "已完成");
    expect(started).toEqual([ids[0], ids[1], ids[2], ids[3]]); /* 终态补位 */
  });

  it("同日同类型活跃去重", () => {
    q.setTaskRunner(() => makeGate().promise);
    const first = q.enqueueTask("手动生成", "2026-09-27", "omp");
    expect(q.enqueueTask("手动生成", "2026-09-27", "omp")).toBeNull();
    expect(q.getGenTasks().filter((t) => t.dayKey === "2026-09-27")).toHaveLength(1);
    expect(first).not.toBeNull();
  });

  it("手动任务类型选择:失败重试 / 有文章增量并入 / 否则手动生成", () => {
    expect(q.dayGenTaskType(true, false)).toBe("重试生成");
    expect(q.dayGenTaskType(false, true)).toBe("增量并入");
    expect(q.dayGenTaskType(false, false)).toBe("手动生成");
  });

  it("同日已有 run/queue 任务(任意类型)时 enqueueTask 返回 null;不同日不受影响", () => {
    q.setTaskRunner(() => makeGate().promise);
    q.enqueueTask("手动生成", "2026-09-27", "omp");
    expect(q.enqueueTask("增量并入", "2026-09-27", "omp")).toBeNull();
    expect(q.enqueueTask("定时生成", "2026-09-27", "omp")).toBeNull();
    expect(q.getGenTasks().filter((t) => t.dayKey === "2026-09-27")).toHaveLength(1);
    expect(q.enqueueTask("手动生成", "2026-09-26", "omp")).not.toBeNull();
  });

  it("日粒度活跃闸跨类型拦截(hasActiveTaskForDay 纯读预检)", () => {
    q.setTaskRunner(() => makeGate().promise);
    q.enqueueTask("手动生成", "2026-09-27", "omp");
    expect(q.hasActiveTaskForDay("2026-09-27")).toBe(true);
    expect(q.hasActiveTaskForDay("2026-09-26")).toBe(false);
  });

  it("run 态可终止:aborter 收割会话,放行下一发;迟到回调不复活", () => {
    const gate = makeGate();
    const started: number[] = [];
    const aborted: (string | undefined)[] = [];
    q.setTaskRunner(
      (task) => {
        started.push(task.id);
        return gate.promise;
      },
      (task) => aborted.push(task.sessionId),
    );
    const a = q.enqueueTask("手动生成", "2026-09-27", "omp")!;
    const b = q.enqueueTask("手动生成", "2026-09-26", "omp")!;
    q.startTaskRun(a.id, "pty-9", "生成中"); /* spawn 落地即绑 sessionId */
    expect(q.cancelTask(a.id)).toBe(true); /* run 态终止 */
    expect(aborted).toEqual(["pty-9"]);
    expect(started).toEqual([a.id, b.id]); /* 双槽并发在途(a 终止后无第三发可补) */
    const ta = q.getGenTasks().find((t) => t.id === a.id)!;
    expect(ta.st).toBe("err");
    expect(ta.text).toContain("已取消");
    /* 取消后迟到的结算/绑定不复活、不覆盖 */
    q.startTaskRun(a.id, "pty-late", "迟到绑定");
    q.finishTask(a.id, true, "迟到完成");
    const ta2 = q.getGenTasks().find((t) => t.id === a.id)!;
    expect(ta2.st).toBe("err");
    expect(ta2.sessionId).toBe("pty-9");
    gate.open();
    q.finishTask(b.id, true, "已完成");
  });

  it("卸载停泵:null runner 不再泵排队(防空转 runner 卡死)", () => {
    const gate = makeGate();
    const started: number[] = [];
    q.setTaskRunner((task) => {
      started.push(task.id);
      return gate.promise;
    });
    const a = q.enqueueTask("手动生成", "2026-09-27", "omp")!;
    const b = q.enqueueTask("手动生成", "2026-09-26", "omp")!;
    const c = q.enqueueTask("手动生成", "2026-09-25", "omp")!;
    const d = q.enqueueTask("手动生成", "2026-09-24", "omp")!;
    q.setTaskRunner(null); /* 卸载:a/b/c 在途,d 排队 */
    gate.open();
    for (const t of [a, b, c]) q.finishTask(t.id, true, "已完成"); /* 旧 runner 终态回调仍可用 */
    expect(started).toEqual([a.id, b.id, c.id]); /* d 未被泵进空转 runner */
    expect(q.getGenTasks().find((t) => t.id === d.id)!.st).toBe("queue");
  });

  it("恢复:run 改判中断,queue 保留并续跑", () => {
    const run = vi.fn(() => Promise.resolve());
    q.setTaskRunner(run);
    q.restoreTasks([
      { id: 5, dayKey: "2026-09-27", type: "定时生成", engine: "omp", st: "run", text: "生成中", sessionId: "pty-1" },
      { id: 6, dayKey: "2026-09-26", type: "手动生成", engine: "omp", st: "queue", text: "排队中" },
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

  it("run 态超硬顶自动判失败并放行下一发(spawn 挂死自愈)", async () => {
    vi.useFakeTimers();
    try {
      const gate = makeGate();
      const started: number[] = [];
      const aborted: number[] = [];
      q.setTaskRunner(
        (task) => {
          started.push(task.id);
          return gate.promise; /* 永不结算:模拟 createSession 挂起 */
        },
        (task) => aborted.push(task.id),
      );
      const a = q.enqueueTask("手动生成", "2026-09-27", "omp")!;
      const b = q.enqueueTask("手动生成", "2026-09-26", "omp")!;
      await vi.advanceTimersByTimeAsync(21 * 60_000); /* 跨过 20 分硬顶 + 30s 审计节拍 */
      expect(started).toEqual([a.id, b.id]); /* 双槽并发起跑 */
      for (const id of [a.id, b.id]) {
        const t = q.getGenTasks().find((x) => x.id === id)!;
        expect(t.st).toBe("err");
        expect(t.text).toContain("20 分钟");
      }
      expect([...aborted].sort((x, y) => x - y)).toEqual([a.id, b.id]); /* 收割体逐个被调(pre-spawn 段由检查点自弃) */
      gate.open();
    } finally {
      vi.useRealTimers();
    }
  });
});
