/**
 * 后台生成任务队列 —— 定时/手动/增量/重试/补齐一律进队列,至多 MAX_CONCURRENT_RUNS
 * 个生成会话并发(余者排队;排队与运行皆可取消,失败可重试)。任务史截尾 50 落 meta.json,
 * 重启后 run 态改判「中断」。生成执行体由 genSession 注入(setTaskRunner),
 * 队列不认识会话语义。
 */
import { createSubscribable } from "@kernel/subscribable";

/* 开发热更纪律:本模块是 activate 期注入执行体(setTaskRunner)与持久化通道的常驻
 * 单例,却被组件模块(ArticleTab/MonthView/TaskPanel)直接引用 —— 组件边界热更会把
 * 改动链上的本模块重造为无泵、无绑定的镜像实例,入队任务永卡「排队中」且 meta.json
 * 无痕(2026-09-30 实证)。自接受 + 整页重载:凡本文件被改,全图重新接线。 */
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

export type GenTaskType = "定时生成" | "启动补跑" | "手动生成" | "增量并入" | "重试生成" | "补齐生成" | "首次提取";

export interface GenTask {
  id: number;
  /** YYYY-MM-DD。 */
  dayKey: string;
  type: GenTaskType;
  engine: string;
  st: "queue" | "run" | "done" | "err";
  text: string;
  /** 生成会话 host id(run/done 有;排队无)。 */
  sessionId?: string;
  /** run 起跑时刻(ms);硬顶审计判超龄用,终态不清。 */
  runAt?: number;
}

interface QueueState {
  tasks: GenTask[];
}

const store = createSubscribable<QueueState>({ tasks: [] });
let nextId = 1;

/** 并发上限:3 槽(用户 2026-09-30 拍板;额度消耗与终端输出随槽数线性放大)。 */
const MAX_CONCURRENT_RUNS = 3;

/** run 态硬顶:超龄 run 自动判失败并放行队列 —— createSession/摘录构建等前置段
 *  在 SETTLE_TIMEOUT_MS 武装前是无兜底等待窗,此处结构性兜底(spawn 挂死也能自愈)。
 *  须 > genSession 的 SETTLE_TIMEOUT_MS(15 分)+ 前置段余量,取 20 分。 */
const RUN_HARD_TOP_MS = 20 * 60_000;
/** 审计节拍(常驻单句柄;HMR 整页重载即随模块重置,无泄漏路径)。 */
const AUDIT_TICK_MS = 30_000;
type TimerHandle = ReturnType<typeof setInterval>;
let auditTimer: TimerHandle | undefined;

function ensureAudit(): void {
  if (auditTimer !== undefined) return;
  auditTimer = setInterval(() => {
    const now = Date.now();
    for (const t of store.snapshot.tasks) {
      if (t.st !== "run" || t.runAt === undefined || now - t.runAt < RUN_HARD_TOP_MS) continue;
      patch(t.id, { st: "err", text: "运行超 20 分钟,自动判失败(可重试)" });
      abortRun?.(t); /* 会话收割:pre-spawn 段无 sessionId,由检查点自弃 */
      pump();
    }
  }, AUDIT_TICK_MS);
}

let persist: ((tasks: GenTask[]) => void) | null = null;
let runner: ((task: GenTask) => Promise<void>) | null = null;
let abortRun: ((task: GenTask) => void) | null = null;

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

/** genSession 注入执行体(队列 → 真实会话生成)与 run 态收割体(取消时杀会话);
 * 注册即开泵(接住恢复的排队);卸载传 null 停泵(排队保留,不得泵进空转 runner)。 */
export function setTaskRunner(fn: ((task: GenTask) => Promise<void>) | null, abort?: (task: GenTask) => void): void {
  runner = fn;
  abortRun = abort ?? null;
  pump();
}

/** 任务是否仍处 run 态(genSession 取消竞态检查点用)。 */
export function isTaskActive(id: number): boolean {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  return !!t && t.st === "run";
}

function commit(): void {
  const tasks = store.snapshot.tasks.slice(0, 50); /* 内存与持久化同截尾 */
  persist?.(tasks);
  store.commit({ tasks: [...tasks] });
}

/** 活跃(run/queue)任务里按日粒度去重:同日任意类型已有任务即拒,防止两个
 *  agent read-modify-write 同一篇文章互相丢更新(定时/补跑/auto 增量/补齐/重试
 *  等自动口不过 hasActiveTaskForDay 预检,此处是唯一闸口)。 */
export function enqueueTask(type: GenTaskType, dayKey: string, engine: string): GenTask | null {
  const dup = store.snapshot.tasks.some((t) => t.dayKey === dayKey && (t.st === "run" || t.st === "queue"));
  if (dup) return null;
  const task: GenTask = { id: nextId++, dayKey, type, engine, st: "queue", text: "排队中" };
  store.commit({ tasks: [task, ...store.snapshot.tasks] });
  commit();
  pump();
  return task;
}

/** 手动生成任务类型选择(纯函数,测试面):失败日重试;已有文章走增量并入(与自动路径命名对齐);否则首次手动生成。 */
export function dayGenTaskType(failed: boolean, hasArticle: boolean): GenTaskType {
  if (failed) return "重试生成";
  return hasArticle ? "增量并入" : "手动生成";
}


/** 队列开泵:run 槽未满时依序补位(runner 异步执行,终态回调推进补位)。 */
function pump(): void {
  if (!runner) return;
  for (
    let slots = MAX_CONCURRENT_RUNS - store.snapshot.tasks.filter((t) => t.st === "run").length;
    slots > 0;
    slots--
  ) {
    const next = [...store.snapshot.tasks].reverse().find((t) => t.st === "queue");
    if (!next) return;
    patch(next.id, { st: "run", text: "生成中", runAt: Date.now() });
    ensureAudit();
    void runner({ ...next, st: "run" }).catch((e: unknown) => {
      patch(next.id, { st: "err", text: `任务异常:${String(e)}` });
      pump();
    });
  }
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
  /* 已被取消的任务不复活:挂起 spawn 期间取消的会话由 runGeneration 检查点自弃。 */
  if (!isTaskActive(id)) return;
  patch(id, { sessionId, text });
}

/** 终态落账(runner/结算回调):推进下一发;已取消(终态)不复活不覆盖。 */
export function finishTask(id: number, ok: boolean, text: string): void {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (t && t.st !== "run") {
    pump();
    return;
  }
  patch(id, { st: ok ? "done" : "err", text });
  pump();
}

/** 排队与运行皆可取消(run 态经 abortRun 收割会话后放行下一发;
 * 是 run 态卡死(spawn 挂起等无兜底窗口)时唯一的手动逃生口)。 */
export function cancelTask(id: number): boolean {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (!t || (t.st !== "queue" && t.st !== "run")) return false;
  if (t.st === "run") {
    patch(id, { st: "err", text: "已取消(终止运行)" });
    abortRun?.(t);
    pump();
  } else {
    patch(id, { st: "err", text: "已取消" });
  }
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
      sessionId: typeof r.sessionId === "string" ? (r.sessionId as string) : undefined,
    });
  }
  if (!tasks.length) return;
  nextId = Math.max(nextId, ...tasks.map((t) => t.id)) + 1;
  store.commit({ tasks });
  pump();
}
