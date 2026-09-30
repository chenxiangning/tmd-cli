/**
 * 生成调度 —— 三源入队:定时(每日 HH:MM 生成前一日,运行期每 15 分钟对表,
 * 错过即补)/ 启动补跑(boot 时昨日缺文章且有会话)/ 跟随实时(增量 auto:
 * 非生成会话退出后 45s 去抖,今日有文章 → 增量并入,无文章有会话 → 首次提取)。
 * 幂等以 beads 留痕为准(定时/补跑当日至多一颗)。
 */
import { KernelTopics } from "@kernel/events";
import type { PluginEventBus } from "@kernel/plugin";
import { dailyPaths, dayKey, readText } from "./journalFiles";
import { dayMetaOf, getJournalState, type MonthSnapshot } from "./journalStore";
import { enqueueTask } from "./taskQueue";
import { collectSessionRowsBatched, rowDayKey, todayKey, type DaySessionRow } from "./daySessions";
import { bootGenSession } from "./genSession";
import { ensureHolidays } from "./holidays";

const TICK_MS = 15 * 60_000;
const AUTO_INC_DEBOUNCE_MS = 45_000;

const yesterdayKey = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

/** 该日是否已有定时/补跑珠子(幂等闸,beads 永存不截尾)。 */
function hadScheduledBead(key: string): boolean {
  return dayMetaOf(key).beads.some((b) => b.label.startsWith("定时生成") || b.label.startsWith("启动补跑"));
}

/** 昨日缺文章但有会话 → 入队(定时/补跑共用判定);在途单飞闸防 boot/首 tick 双发。 */
const inFlightYesterday = new Set<string>();
async function maybeEnqueueYesterday(type: "定时生成" | "启动补跑", engine: string): Promise<void> {
  const key = yesterdayKey();
  if (hadScheduledBead(key) || inFlightYesterday.has(key)) return;
  inFlightYesterday.add(key);
  try {
    await maybeEnqueueYesterdayInner(type, engine);
  } catch {
    /* configDir 不可用(桩/无 Tauri 单测)等扫描失败:静默跳过,下一对表窗口重试。 */
  } finally {
    inFlightYesterday.delete(key);
  }
}

async function maybeEnqueueYesterdayInner(type: "定时生成" | "启动补跑", engine: string): Promise<void> {
  const key = yesterdayKey();
  const paths = await dailyPaths();
  const [y, m, d] = [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))];
  if (await readText(paths.article(y, m, d))) return;
  const rows = (await collectSessionRowsBatched()).some((r) => rowDayKey(r) === key);
  if (rows) enqueueTask(type, key, engine);
}

let autoIncTimer: ReturnType<typeof setTimeout> | undefined;

/** 跟随实时:非生成会话退出 → 去抖后对今日做一次增量判定。 */
function scheduleAutoIncrement(engine: string, exitedSessionId: string): void {
  clearTimeout(autoIncTimer);
  autoIncTimer = setTimeout(() => {
    void (async () => {
      const key = todayKey();
      if (dayMetaOf(key).sessionId === exitedSessionId) return; /* 生成会话自身退出:结算链管 */
      const paths = await dailyPaths();
      const [y, m, d] = [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))];
      const hasArticle = !!(await readText(paths.article(y, m, d)));
      const hasSessions = (await collectSessionRowsBatched()).some((r) => rowDayKey(r) === key);
      if (hasArticle) enqueueTask("增量并入", key, engine);
      else if (hasSessions) enqueueTask("首次提取", key, engine);
    })().catch(() => undefined); /* configDir 不可用等失败静默:增量判定非关键路径 */
  }, AUTO_INC_DEBOUNCE_MS);
}

/** activate 时装配;返回退订(退定时器 + 事件 + 生成体)。 */
/** activate 时装配;返回退订。武装等待 bootJournal 就绪:配置异步落位前 tick
 * 读到的是 DEFAULT(引擎/开关全错配),必须等 meta.json 读回后再对表(B4 评审 P1-1)。 */
export function bootJournalSchedule(events: PluginEventBus, ready: Promise<void>): () => void {
  const engine = () => getJournalState().config.engine;
  const hourMinuteOf = (timerTime: string): number => {
    const [hh, mm] = timerTime.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 8 * 60; /* 坏配置回落 08:00 */
    return hh * 60 + mm;
  };
  const tick = () => {
    const { timerOn, timerTime } = getJournalState().config;
    const now = new Date();
    if (timerOn && now.getHours() * 60 + now.getMinutes() >= hourMinuteOf(timerTime)) {
      void maybeEnqueueYesterday("定时生成", engine());
    }
    void ensureHolidays(now.getFullYear()); /* 每日增量拉取语义:24h 新鲜度窗内零请求 */
  };
  let iv: ReturnType<typeof setInterval> | undefined;
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    if (getJournalState().config.timerOn) void maybeEnqueueYesterday("启动补跑", engine());
    tick();
    iv = setInterval(tick, TICK_MS);
  };
  void ready.then(arm);
  const offGen = bootGenSession(events);
  const offExited = events.on<string>(KernelTopics.sessionExited, (sessionId) => {
    if (getJournalState().config.incPolicy !== "auto") return;
    scheduleAutoIncrement(engine(), sessionId);
  });
  return () => {
    if (iv !== undefined) clearInterval(iv);
    clearTimeout(autoIncTimer);
    offExited();
    offGen();
  };
}

/** 「补齐待生成」入队策略(月视图按钮):新到旧限量补齐,防一次点按引爆整月
 *  串行批(2026-09-30 实证:24 任务串行,单个卡住全队,用户被迫逐一取消)。 */
export function fillPendingDays(ym: { y: number; m: number }, sessions: Map<string, DaySessionRow[]>, snap: MonthSnapshot | undefined): void {
  if (!snap) return; /* 快照未就绪不入队:文章索引空窗会误伤已有文章的日 */
  const prefix = `${ym.y}-${String(ym.m).padStart(2, "0")}`;
  const engine = getJournalState().config.engine;
  const missing: string[] = [];
  for (const k of sessions.keys()) {
    if (!k.startsWith(prefix)) continue;
    const dd = k.slice(8);
    if (!snap.articles[dd] && (sessions.get(k)?.length ?? 0) > 0) missing.push(k);
  }
  missing.sort((a, b) => (a < b ? 1 : -1));
  for (const k of missing.slice(0, 3)) enqueueTask("补齐生成", k, engine);
}
