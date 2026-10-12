/**
 * docgen 生成任务队列 —— journal taskQueue 的姊妹实现(3 槽并发/20 分硬顶/
 * 取消收割/启动恢复),按维度键去重(journal 按日键)。自动口(排程/补跑)与
 * 手动口都从这里过,唯一闸口。
 *
 * 开发热更纪律:本模块是 activate 期注入执行体的常驻单例,却被组件模块直接
 * 引用 —— 组件边界热更会重造无泵镜像实例,入队任务永卡「排队中」(journal
 * taskQueue 2026-09-30 实证)。自接受 + 整页重载。
 */
import { createSubscribable } from "@kernel/subscribable";
import { t } from "@kernel/i18n";
import { failEntry, persistQueueTasks } from "./store";

if (import.meta.hot) import.meta.hot.accept(() => location.reload());

export type DocGenTaskType = "手动生成" | "重试生成" | "排程生成" | "启动补跑";

export interface DocGenTask {
  id: number;
  /** 目标条目(结算/收割都定位到它)。 */
  entryId: string;
  /** 维度键(模板×范围×周期):活跃去重 + 重新生成续版本链。 */
  dimensionKey: string;
  type: DocGenTaskType;
  engine: string;
  st: "queue" | "run" | "done" | "err";
  text: string;
  /** 生成阶段 0-3(stagebar 消费;仅 run 期有意义,恢复任务缺省按 text 兜底)。 */
  stage?: number;
  sessionId?: string;
  runAt?: number;
}

const MAX_CONCURRENT_RUNS = 3;
/** 须 > genSession SETTLE_TIMEOUT(15 分)+ 前置段余量。 */
const RUN_HARD_TOP_MS = 20 * 60_000;
const AUDIT_TICK_MS = 30_000;
const PERSIST_TAIL = 50;

interface QueueState {
  tasks: DocGenTask[];
}

const store = createSubscribable<QueueState>({ tasks: [] });
let nextId = 1;
let runner: ((task: DocGenTask) => Promise<void>) | null = null;
let abortRun: ((task: DocGenTask) => void) | null = null;
type TimerHandle = ReturnType<typeof setInterval>;
let auditTimer: TimerHandle | undefined;

export function useDocGenTasks(): DocGenTask[] {
  return store.useStore((s) => s.tasks);
}

export function getDocGenTasks(): readonly DocGenTask[] {
  return store.snapshot.tasks;
}

/** journal journalStore.setMetaTasks 同位:队列截尾落 docgen.json(经 store.persistQueueTasks)。 */
function commitPersist(): void {
  const tasks = store.snapshot.tasks.slice(0, PERSIST_TAIL);
  persistQueueTasks(tasks);
  store.commit({ tasks: [...tasks] });
}

function ensureAudit(): void {
  if (auditTimer !== undefined) return;
  auditTimer = setInterval(() => {
    const now = Date.now();
    for (const task of store.snapshot.tasks) {
      if (task.st === "run" && task.runAt !== undefined && now - task.runAt > RUN_HARD_TOP_MS) {
        patch(task.id, { st: "err", text: t("超时(20 分钟硬顶,自动收割)") });
        abortRun?.(task);
        pump();
      }
    }
  }, AUDIT_TICK_MS);
}

/** 注入执行体与收割体;注册即开泵(接住恢复的排队)。 */
export function setDocGenRunner(fn: ((task: DocGenTask) => Promise<void>) | null, abort?: (task: DocGenTask) => void): void {
  runner = fn;
  abortRun = abort ?? null;
  pump();
}

export function isDocGenTaskActive(id: number): boolean {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  return !!t && t.st === "run";
}

/** 同维度键活跃(run/queue)去重:防两个 agent 写同一 v<N> 互相丢更新。 */
export function enqueueDocGenTask(type: DocGenTaskType, entryId: string, dimensionKey: string, engine: string): DocGenTask | null {
  const dup = store.snapshot.tasks.some((t) => t.dimensionKey === dimensionKey && (t.st === "run" || t.st === "queue"));
  if (dup) return null;
  const task: DocGenTask = { id: nextId++, entryId, dimensionKey, type, engine, st: "queue", text: t("排队中") };
  store.commit({ tasks: [task, ...store.snapshot.tasks] });
  commitPersist();
  pump();
  return task;
}

function pump(): void {
  if (!runner) return;
  for (
    let slots = MAX_CONCURRENT_RUNS - store.snapshot.tasks.filter((t) => t.st === "run").length;
    slots > 0;
    slots--
  ) {
    const next = [...store.snapshot.tasks].reverse().find((t) => t.st === "queue");
    if (!next) return;
    patch(next.id, { st: "run", text: t("生成中"), runAt: Date.now() });
    ensureAudit();
    void runner({ ...next, st: "run" }).catch((e: unknown) => {
      /* 兜底收割:runDocGen 自身异常未落终态时,entry 不能丢在 gen 态。 */
      patch(next.id, { st: "err", text: `${t("任务异常")}:${String(e)}` });
      void failEntry(next.entryId, `${t("任务异常")}:${String(e)}`).catch(() => undefined);
      pump();
    });
  }
}

export function noteDocGenTask(id: number, text: string): void {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (t && t.st === "run") patch(id, { text });
}

/** 阶段打点(文案+阶段号同写,stagebar 不再猜文本;locale 无关)。 */
export function noteDocGenStage(id: number, stage: number, text: string): void {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (t && t.st === "run") patch(id, { text, stage });
}

function patch(id: number, p: Partial<DocGenTask>): void {
  store.commit({ tasks: store.snapshot.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  commitPersist();
}

export function startDocGenTaskRun(id: number, sessionId: string, text: string): void {
  if (!isDocGenTaskActive(id)) return;
  patch(id, { sessionId, text, stage: 2 });
}

export function finishDocGenTask(id: number, ok: boolean, text: string): void {
  const t = store.snapshot.tasks.find((x) => x.id === id);
  if (t && t.st !== "run") {
    pump();
    return;
  }
  patch(id, { st: ok ? "done" : "err", text });
  pump();
}

/** 排队与运行皆可取消;run 态经收割体杀会话后放行下一发。 */
export function cancelDocGenTask(id: number): boolean {
  const task = store.snapshot.tasks.find((x) => x.id === id);
  if (!task || (task.st !== "queue" && task.st !== "run")) return false;
  if (task.st === "run") {
    patch(id, { st: "err", text: t("已取消(终止运行)") });
    abortRun?.(task);
    pump();
  } else {
    patch(id, { st: "err", text: t("已取消") });
    /* 排队取消对称收割:entry 落 fail 态拿重试入口,否则永卡 gen(终止/重试双失效)。 */
    void failEntry(task.entryId, t("已取消(尚未开始生成)")).catch(() => undefined);
  }
  return true;
}

/** 启动恢复:run 改判中断(会话已随进程消失),queue 保留续跑。 */
export function restoreDocGenTasks(saved: unknown): void {
  if (!Array.isArray(saved)) return;
  const tasks: DocGenTask[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "number" || typeof r.entryId !== "string" || typeof r.dimensionKey !== "string") continue;
    const st = r.st === "queue" ? "queue" : r.st === "run" ? "err" : r.st === "done" || r.st === "err" ? r.st : "done";
    tasks.push({
      id: r.id as number,
      entryId: r.entryId as string,
      dimensionKey: r.dimensionKey as string,
      type: (r.type as DocGenTaskType) ?? "手动生成",
      engine: typeof r.engine === "string" ? r.engine : "omp",
      st,
      text: st === "err" && r.st === "run" ? t("中断(应用重启)") : String(r.text ?? ""),
      sessionId: typeof r.sessionId === "string" ? (r.sessionId as string) : undefined,
    });
    if (st === "err" && r.st === "run") {
      /* run→err 改判的条目同步收割:否则 entry 永卡 gen、终止/重试双失效。 */
      void failEntry(r.entryId as string, t("中断(应用重启)")).catch(() => undefined);
    }
  }
  if (tasks.length === 0) return;
  nextId = Math.max(nextId, ...tasks.map((t) => t.id)) + 1;
  store.commit({ tasks });
  pump();
}
