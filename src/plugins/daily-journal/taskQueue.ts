/**
 * 后台生成任务队列 —— 定时/手动/增量/重试/补齐一律进队列,单并发(同时至多一个
 * 生成会话在跑,余者排队;可取消排队,失败可重试)。任务史截尾 50 落 meta.json,
 * 重启后 run 态改判「中断」。生成执行体由 genSession 注入(setTaskRunner),
 * 队列不认识会话语义。
 */
import { createSubscribable } from "@kernel/subscribable";

export type GenTaskType = "定时生成" | "启动补跑" | "手动生成" | "增量并入" | "重试生成" | "补齐生成" | "首次提取";

export interface GenTask {
  id: number;
  /** YYYY-MM-DD。 */
  dayKey: string;
  type: GenTaskType;
  engine: string;
  st: "queue" | "run" | "done" | "err";
  text: string;
  since: number;
  /** 生成会话 host id(run/done 有;排队无)。 */
  sessionId?: string;
}

interface QueueState {
  tasks: GenTask[];
}

const store = createSubscribable<QueueState>({ tasks: [] });
let nextId = 1;
let persist: ((tasks: GenTask[]) => void) | null = null;
let runner: ((task: GenTask) => Promise<void>) | null = null;

export function useGenTasks(): GenTask[] {
  return store.useStore((s) => s.tasks);
}

export function getGenTasks(): readonly GenTask[] {
  return store.snapshot.tasks;
}

/** journalStore 注入持久化通道(meta.tasks 截尾 50)。 */
export function bindTaskPersistence(fn: (tasks: GenTask[]) => void): void {
  persist = fn;
}

/** genSession 注入执行体(队列 → 真实会话生成);注册即开泵(接住恢复的排队)。 */
export function setTaskRunner(fn: (task: GenTask) => Promise<void>): void {
  runner = fn;
  pump();
}

function commit(): void {
  const tasks = store.snapshot.tasks.slice(0, 50); /* 内存与持久化同截尾 */
  persist?.(tasks);
  store.commit({ tasks: [...tasks] });
}

/** 活跃(run/queue)任务里同日同类型去重:重复入队幂等返回 null。 */
export function enqueueTask(type: GenTaskType, dayKey: string, engine: string): GenTask | null {
  const dup = store.snapshot.tasks.some((t) => t.dayKey === dayKey && t.type === type && (t.st === "run" || t.st === "queue"));
  if (dup) return null;
  const task: GenTask = { id: nextId++, dayKey, type, engine, st: "queue", text: "排队中", since: Date.now() };
  store.commit({ tasks: [task, ...store.snapshot.tasks] });
  commit();
  pump();
  return task;
}

/** 队列开泵:无 run 任务时取队首启动(runner 异步执行,终态回调推进下一发)。 */
function pump(): void {
  const running = store.snapshot.tasks.some((t) => t.st === "run");
  if (running || !runner) return;
  const next = [...store.snapshot.tasks].reverse().find((t) => t.st === "queue");
  if (!next) return;
  patch(next.id, { st: "run", text: "生成中" });
  void runner({ ...next, st: "run" }).catch((e: unknown) => {
    patch(next.id, { st: "err", text: `任务异常:${String(e)}` });
    pump();
  });
}

/** run 态文案更新(进度提示;不动状态、不泵)。 */
export function noteTask(id: number, text: string): void {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (t && t.st === "run") patch(id, { text });
}

function patch(id: number, p: Partial<GenTask>): void {
  store.commit({ tasks: store.snapshot.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  commit();
}

export function startTaskRun(id: number, sessionId: string, text: string): void {
  patch(id, { st: "run", sessionId, text });
}

export function finishTask(id: number, ok: boolean, text: string): void {
  patch(id, { st: ok ? "done" : "err", text });
  pump();
}

/** 仅排队可取消。 */
export function cancelTask(id: number): boolean {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (!t || t.st !== "queue") return false;
  patch(id, { st: "err", text: "已取消" });
  return true;
}

/** 删除一条终态任务(done/err;清理历史用,queue/run 拒绝)。 */
export function removeTask(id: number): boolean {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (!t || (t.st !== "done" && t.st !== "err")) return false;
  store.commit({ tasks: store.snapshot.tasks.filter((x) => x.id !== id) });
  commit();
  return true;
}

/** 启动恢复(meta.tasks 读回):run 改判中断,queue 保留续跑。 */
export function restoreTasks(saved: unknown): void {
  if (!Array.isArray(saved)) return;
  const tasks: GenTask[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "number" || typeof r.dayKey !== "string") continue;
    const st = r.st === "queue" ? "queue" : r.st === "run" ? "err" : r.st === "done" || r.st === "err" ? r.st : "done";
    tasks.push({
      id: r.id as number,
      dayKey: r.dayKey as string,
      type: (r.type as GenTaskType) ?? "手动生成",
      engine: typeof r.engine === "string" ? r.engine : "omp",
      st,
      text: st === "err" && r.st === "run" ? "中断(应用重启)" : String(r.text ?? ""),
      since: typeof r.since === "number" ? (r.since as number) : 0,
      sessionId: typeof r.sessionId === "string" ? (r.sessionId as string) : undefined,
    });
  }
  if (!tasks.length) return;
  nextId = Math.max(nextId, ...tasks.map((t) => t.id)) + 1;
  store.commit({ tasks });
  pump();
}
