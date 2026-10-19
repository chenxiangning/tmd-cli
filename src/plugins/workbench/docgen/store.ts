/**
 * docgen 存储 —— docgen.json 单权威 + 订阅面 + 版本链/状态机变迁。
 * 写路径经 storeCore.enqueue 串行(与 workbench index 写共享一条队,防交错);
 * 队列任务持久化经 bindTaskPersistence 注入(queue ↔ index 双向只此一条缝)。
 */
import { createSubscribable } from "@kernel/subscribable";
import { enqueue } from "../storeCore";
import { randId } from "../types";
import { readDocGenIndex, removeEntryDir, writeDocGenIndex } from "./paths";
import { EMPTY_DOCGEN_INDEX, type DocGenEntry, type DocGenIndexFile, type DocGenSchedule, type DocGenStatus } from "./types";

interface DocGenState {
  entries: DocGenEntry[];
  schedule: DocGenSchedule;
  loaded: boolean;
}

const store = createSubscribable<DocGenState>({
  entries: [],
  schedule: EMPTY_DOCGEN_INDEX.schedule,
  loaded: false,
});

/** 内存单权威(写文件的数据源);loadDocGen 后与磁盘一致。 */
let currentIndex: DocGenIndexFile = EMPTY_DOCGEN_INDEX;
let persistTasks: ((tasks: unknown[]) => void) | null = null;

export function useDocGenEntries(): DocGenEntry[] {
  return store.useStore((s) => s.entries);
}

export function useDocGenSchedule(): DocGenSchedule {
  return store.useStore((s) => s.schedule);
}

export function docgenSchedule(): DocGenSchedule {
  return store.snapshot.schedule;
}

/** 队列注入持久化通道(tasks 截尾由 queue 负责)。 */
export function bindDocGenTaskPersistence(fn: (tasks: unknown[]) => void): void {
  persistTasks = fn;
}

function commit(): void {
  store.commit({ entries: [...currentIndex.entries], schedule: { ...currentIndex.schedule }, loaded: store.snapshot.loaded });
}

/** 全部落盘走这里:串行队 + 失败上抛(调用方 toast);内存态不回滚——docgen.json
 *  写失败属磁盘异常,内存保持新态供 UI 继续操作,下一条变更会重写覆盖。 */
function save(): Promise<void> {
  return enqueue(async () => {
    await writeDocGenIndex(currentIndex);
  });
}

/** activate 期读档;返回恢复用队列任务(交 restoreTasks)。 */
export async function loadDocGen(): Promise<unknown[]> {
  currentIndex = await readDocGenIndex();
  store.commit({ entries: [...currentIndex.entries], schedule: { ...currentIndex.schedule }, loaded: true });
  return currentIndex.tasks;
}

export function entryById(id: string): DocGenEntry | undefined {
  return store.snapshot.entries.find((e) => e.id === id);
}

/** 下一版本号(入队前确定结算目标文件 v<N>)。 */
export function nextVersion(id: string): number {
  return (entryById(id)?.versions.length ?? 0) + 1;
}

export interface DocGenEntryInit {
  templateId: string;
  title: string;
  scope: DocGenEntry["scope"];
  periodKey: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  audience: string;
  engine: string;
  sources: DocGenEntry["sources"];
  additional?: string;
  language?: string;
  scheduled?: boolean;
}

/** 新建条目(gen 态即入列;同维度键复用旧条目续版本链)。 */
export async function createEntry(init: DocGenEntryInit): Promise<DocGenEntry> {
  const dimension = dimensionKeyOf(init.templateId, init.scope, init.periodKey);
  const existing = store.snapshot.entries.find((e) => dimensionKeyOf(e.templateId, e.scope, e.periodKey) === dimension);
  const now = new Date().toISOString();
  if (existing) {
    /* 同维度复用:弹窗里改过的口径(标题/事实源/周期区间)一并刷新,别拿旧值拼 prompt。 */
    const patched: DocGenEntry = {
      ...existing,
      status: "gen",
      title: init.title,
      engine: init.engine,
      audience: init.audience,
      sources: init.sources,
      periodLabel: init.periodLabel,
      periodFrom: init.periodFrom,
      periodTo: init.periodTo,
      language: init.language,
      additional: init.additional,
      error: undefined,
      scheduled: init.scheduled,
      updatedAt: now,
    };
    await applyEntry(patched);
    return patched;
  }
  const entry: DocGenEntry = {
    id: randId("dg"),
    templateId: init.templateId,
    title: init.title,
    scope: init.scope,
    periodKey: init.periodKey,
    periodLabel: init.periodLabel,
    periodFrom: init.periodFrom,
    periodTo: init.periodTo,
    audience: init.audience,
    engine: init.engine,
    sources: init.sources,
    additional: init.additional,
    language: init.language,
    status: "gen",
    docState: "draft",
    versions: [],
    createdAt: now,
    updatedAt: now,
    scheduled: init.scheduled,
  };
  await applyEntry(entry);
  return entry;
}

async function applyEntry(entry: DocGenEntry): Promise<void> {
  const others = currentIndex.entries.filter((e) => e.id !== entry.id);
  currentIndex = { ...currentIndex, entries: [entry, ...others] };
  commit();
  await save();
}

/** 版本落账(结算成功):实体文件已由 genSession 写好,这里只记账。 */
export async function settleEntry(id: string, engine: string): Promise<number> {
  const entry = entryById(id);
  if (!entry) throw new Error(`文档条目不存在: ${id}`);
  const v = entry.versions.length + 1;
  const now = new Date().toISOString();
  await applyEntry({
    ...entry,
    status: "done",
    docState: "draft",
    versions: [...entry.versions, { v, at: now, engine }],
    error: undefined,
    updatedAt: now,
  });
  return v;
}

export async function failEntry(id: string, error: string): Promise<void> {
  const entry = entryById(id);
  if (!entry) return;
  await applyEntry({ ...entry, status: "fail", error, updatedAt: new Date().toISOString() });
}

export async function setEntryGenMeta(id: string, meta: { sessionId?: string }): Promise<void> {
  const entry = entryById(id);
  if (!entry) return;
  await applyEntry({ ...entry, ...meta, updatedAt: new Date().toISOString() });
}

/** 终止收割:有历史版本回落 done(重新生成场景),首版未产出整条移除。 */
export async function terminateEntry(id: string): Promise<void> {
  const entry = entryById(id);
  if (!entry) return;
  if (entry.versions.length > 0) {
    await applyEntry({ ...entry, status: "done", error: undefined, updatedAt: new Date().toISOString() });
  } else {
    currentIndex = { ...currentIndex, entries: currentIndex.entries.filter((e) => e.id !== id) };
    commit();
    await save();
    void removeEntryDir(id).catch(() => undefined); /* 孤儿 prompt/半截产物目录顺手清(失败静默) */
  }
}

/** 存储管家清理口:已归档条目整条移除(索引先落,目录删失败补偿回写)。
 *  必须走本函数而非裸读写 docgen.json —— 内存 currentIndex 是单权威,
 *  任何 save()/writeTasksNow() 都会整体重写索引,裸删会被静默复活。 */
export async function removeArchivedEntry(id: string): Promise<void> {
  const removed = currentIndex.entries.filter((e) => e.id === id);
  if (removed.length === 0) return;
  currentIndex = { ...currentIndex, entries: currentIndex.entries.filter((e) => e.id !== id) };
  try {
    await save(); /* 队列内写的是同一份内存,排队中的旧写不会复活本删除 */
  } catch (e) {
    currentIndex = { ...currentIndex, entries: [...currentIndex.entries, ...removed] };
    commit();
    throw e;
  }
  try {
    await removeEntryDir(id);
  } catch (e) {
    /* 宁可条目复活可重删,不可索引与盘面脱节成孤儿 */
    currentIndex = { ...currentIndex, entries: [...currentIndex.entries, ...removed] };
    commit();
    await save().catch(() => undefined); /* 补偿写失败交由下一次 save 收敛 */
    throw e;
  }
  commit();
}

/** 文档状态流转(草稿 → 已汇报 → 已归档 → 草稿循环)。 */
export async function toggleDocState(id: string): Promise<DocGenStatus | undefined> {
  const entry = entryById(id);
  if (!entry || entry.status !== "done") return undefined;
  const next = entry.docState === "draft" ? "reported" : entry.docState === "reported" ? "archived" : "draft";
  await applyEntry({ ...entry, docState: next, updatedAt: new Date().toISOString() });
  return entry.status;
}

export async function updateSchedule(patch: Partial<DocGenSchedule>): Promise<void> {
  currentIndex = { ...currentIndex, schedule: { ...currentIndex.schedule, ...patch } };
  commit();
  await save();
}

/** 队列任务落盘(queue 截尾后回传;不触发 entries 订阅)。 */
export function persistQueueTasks(tasks: unknown[]): void {
  persistTasks?.(tasks);
}

async function writeTasksNow(tasks: unknown[]): Promise<void> {
  currentIndex = { ...currentIndex, tasks };
  await enqueue(async () => {
    await writeDocGenIndex(currentIndex);
  });
}

/** activate 装配期绑定:队列持久化 → docgen.json tasks 字段。 */
export function attachTaskPersistChannel(): void {
  bindDocGenTaskPersistence((tasks) => {
    void writeTasksNow(tasks).catch(() => undefined);
  });
}

/** 维度键:同模板×范围×周期复用条目续版本链。 */
export function dimensionKeyOf(templateId: string, scope: DocGenEntry["scope"], periodKey: string): string {
  return `${templateId}|${scope.kind === "one" ? scope.projectId : "all"}|${periodKey}`;
}
