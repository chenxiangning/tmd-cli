/**
 * 每日日志模块级 store(插件常驻:activate 时 boot,tab 不开也持续服务事件驱动的
 * 生成/增量 —— B4 任务队列同住此层)。数据源三档:article/*.md(解析后缓存)、
 * notes/*.json、meta.json;全部经 journalFiles io,单进程唯一写者。
 *
 * DayStatus 派生不落盘(见 spec):文章存在 → 今日 t / 往日 g;无文章有会话 → p;
 * meta 记 lastError 且无文章 → f;否则 n(可有便签)。
 */
import { createSubscribable } from "@kernel/subscribable";
import {
  DEFAULT_CONFIG,
  EMPTY_META,
  dailyPaths,
  pad2,
  readJson,
  readText,
  writeJson,
  type DayMeta,
  type DayNote,
  type JournalBead,
  type JournalConfig,
  type MetaFile,
  type NotesMonthFile,
} from "./journalFiles";
import { parseArticle, type Article } from "./articleParse";
import { restoreTasks } from "./taskQueue";

/* 开发热更纪律:booted 标志/月快照/meta 写链/任务持久化回调都钉在 activate 期的模块
 * 实例上,组件边界热更会重造无绑定镜像(水位/珠子消失显示、任务不落盘),见 taskQueue
 * 同款守卫注释。自接受 + 整页重载。 */
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

export type DayStatus = "g" | "t" | "p" | "f" | "n";

/** 月快照:articles 按 "DD" 存(值 null = 已探查无文章)。 */
export interface MonthSnapshot {
  articles: Record<string, Article | null>;
  notes: NotesMonthFile;
}

export interface JournalState {
  ready: boolean;
  config: JournalConfig;
  meta: MetaFile;
  months: Record<string, MonthSnapshot | undefined>;
}

const store = createSubscribable<JournalState>({
  ready: false,
  config: DEFAULT_CONFIG,
  meta: EMPTY_META,
  months: {},
});

let booted = false;
let bootPromise: Promise<void> | null = null;

const monthId = (y: number, m: number): string => `${y}-${pad2(m)}`;

/** activate 时调一次;重复调幂等(热重载/测试复用)。 */
export function bootJournal(): Promise<void> {
  bootPromise ??= (async () => {
    const paths = await dailyPaths();
    const meta = await readJson<MetaFile>(paths.meta, EMPTY_META);
    const config = { ...DEFAULT_CONFIG, ...(meta.config ?? {}) };
    store.commit({ ...store.snapshot, ready: true, config, meta: { ...EMPTY_META, ...meta, config } });
    booted = true;
    restoreTasks(meta.tasks); /* 任务史恢复(run 改判中断);队列续跑见 taskQueue 头注 */
  })().catch(() => {
    /* configDir 失败(极端:桩环境无 Tauri)保持未就绪态,UI 走空数据。 */
    bootPromise = null;
  });
  return bootPromise;
}

/** 加载月快照(幂等,已加载跳过;force 重读 —— 生成落盘后刷新用)。 */
export async function loadMonth(y: number, m: number, force = false): Promise<void> {
  if (!booted) await bootJournal();
  const id = monthId(y, m);
  if (!force && store.snapshot.months[id]) return;
  const paths = await dailyPaths();
  const notes = await readJson<NotesMonthFile>(paths.notes(y, m), {});
  const articles: Record<string, Article | null> = {};
  const days = new Date(y, m, 0).getDate();
  await Promise.all(
    Array.from({ length: days }, (_, i) =>
      readText(paths.article(y, m, i + 1)).then((md) => {
        articles[pad2(i + 1)] = md ? parseArticle(md) : null;
      }),
    ),
  );
  const months = { ...store.snapshot.months, [id]: { articles, notes } };
  store.commit({ ...store.snapshot, months });
}

/** 单日文章重读(生成会话落盘后调用;顺带确保月快照在)。 */
export async function reloadDay(y: number, m: number, d: number): Promise<Article | null> {
  const paths = await dailyPaths();
  const md = await readText(paths.article(y, m, d));
  const article = md ? parseArticle(md) : null;
  const id = monthId(y, m);
  const snap = store.snapshot.months[id];
  if (snap) {
    const months = { ...store.snapshot.months, [id]: { ...snap, articles: { ...snap.articles, [pad2(d)]: article } } };
    store.commit({ ...store.snapshot, months });
  }
  return article;
}

/** meta 写串行链:连续更新按序落盘(乱序会丢新值);链尾暴露给测试/收口等待。 */
let metaWrites: Promise<void> = Promise.resolve();
function persistMeta(): void {
  metaWrites = metaWrites
    .then(() => dailyPaths().then((p) => writeJson(p.meta, store.snapshot.meta)))
    .catch(() => undefined); /* 单次失败吞错保链活:后续写继续(内存态为准,下次成功即补齐) */
}

export function journalWritesSettled(): Promise<void> {
  return metaWrites;
}

/** 写/删便签(text 与 images 全量替换;全空 = 删条目)。 */
export async function saveNote(y: number, m: number, d: number, note: DayNote | null): Promise<void> {
  const paths = await dailyPaths();
  const id = monthId(y, m);
  let snap = store.snapshot.months[id];
  if (!snap) {
    await loadMonth(y, m);
    snap = store.snapshot.months[id]!;
  }
  const dd = pad2(d);
  const notes = { ...snap.notes };
  if (note && (note.text.trim() || note.images.length)) notes[dd] = note;
  else delete notes[dd];
  await writeJson(paths.notes(y, m), notes);
  const months = { ...store.snapshot.months, [id]: { ...snap, notes } };
  store.commit({ ...store.snapshot, months });
}

/** 更新配置(全量替换持久化)。 */
export function updateConfig(patch: Partial<JournalConfig>): void {
  const config = { ...store.snapshot.config, ...patch };
  const meta = { ...store.snapshot.meta, config };
  store.commit({ ...store.snapshot, config, meta });
  persistMeta();
}

/** 任务史写入(taskQueue 通道:改 meta.tasks 并落盘)。 */
export function setMetaTasks(tasks: unknown[]): void {
  const meta = { ...store.snapshot.meta, tasks };
  store.commit({ ...store.snapshot, meta });
  persistMeta();
}

/** 日账本取条(缺 = 空壳)。 */
export function dayMetaOf(key: string): DayMeta {
  return store.snapshot.meta.days[key] ?? { beads: [], updatedAt: 0 };
}

/** 追加珠子(一次生成/增量/干涉)。 */
export function addBead(key: string, bead: JournalBead, patch?: Partial<DayMeta>): void {
  const meta = store.snapshot.meta;
  const prev = meta.days[key] ?? { beads: [], updatedAt: 0 };
  const days = { ...meta.days, [key]: { ...prev, ...patch, beads: [...prev.beads, bead], updatedAt: Date.now() } };
  store.commit({ ...store.snapshot, meta: { ...meta, days } });
  persistMeta();
}

/** 生成状态清理/置错(成功清 lastError 并绑会话)。 */
export function setDayResult(key: string, patch: Partial<DayMeta>): void {
  const meta = store.snapshot.meta;
  const prev = meta.days[key] ?? { beads: [], updatedAt: 0 };
  const days = { ...meta.days, [key]: { ...prev, ...patch, updatedAt: Date.now() } };
  store.commit({ ...store.snapshot, meta: { ...meta, days } });
  persistMeta();
}

/** 日状态派生(纯函数,测试面):文章在?今日?会话数?账本错误? */
export function deriveDayStatus(article: Article | null, isToday: boolean, sessionCount: number, meta: DayMeta): DayStatus {
  if (article) return isToday ? "t" : "g";
  if (meta.lastError) return "f";
  if (sessionCount > 0) return "p";
  return "n";
}

/** 热力分档阈值:当月活跃日会话数去重升序取 25/50/75 分位 —— 同数必同档;固定绝对阈值在均匀高强度月份会整月同色,层次感尽失。 */
export type HeatThresholds = readonly [number, number, number];
export function heatThresholds(counts: number[]): HeatThresholds {
  const xs = [...new Set(counts.filter((c) => c > 0))].sort((a, b) => a - b);
  if (!xs.length) return [1, 2, 3];
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return [at(0.25), at(0.5), at(0.75)];
}

/** 热力四级(按当月分位动态分档;spec 取舍:无 token,升级路径 sessionUsage)。 */
export function heatOf(sessionCount: number, ts: HeatThresholds): string {
  if (!sessionCount) return "";
  return sessionCount >= ts[2] ? "h4" : sessionCount >= ts[1] ? "h3" : sessionCount >= ts[0] ? "h2" : "h1";
}

/** 非 React 读点(调度/生成等常驻逻辑)。 */
export function getJournalState(): JournalState {
  return store.snapshot;
}

/** React 订阅(渲染面)。 */
export function useJournalState(): JournalState {
  return store.useStore();
}
