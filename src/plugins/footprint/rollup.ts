/**
 * footprint 写侧:订阅 ckptTurnSealed → 拉最新封口批 → merge 进当月月缓存 →
 * 单飞 promise 链串行落盘(设计 spec:L1 rollup)。读侧经 getMonth 与本模块共享月缓存。
 */
import { ipc } from "@kernel/ipc";
import { KernelTopics, type CkptTurnSealedEvent } from "@kernel/events";
import type { PluginEventBus } from "@kernel/plugin";
import { ensureParentDir } from "@kernel/fsDirs";
import type { CkptBatch } from "@kernel/ipc";
import type { UserCardsFile } from "./userLayer";
import {
  emptyDay, emptyMonth, isCfgPath, settleKey,
  type FootprintDay, type FootprintMonthFile,
} from "./types";

/* ── 路径(configDir 每进程恒定,模块级缓存;journalFiles 同款微任务包一层防桩环境同步抛) ── */

let baseDirP: Promise<string> | null = null;

function baseDir(): Promise<string> {
  baseDirP ??= Promise.resolve().then(() => ipc.configDir());
  return baseDirP;
}

/** ~/.tmd-cli/footprint/YYYY-MM.json */
export async function monthPath(ym: string): Promise<string> {
  return `${await baseDir()}/footprint/${ym}.json`;
}

/** ~/.tmd-cli/footprint/features/YYYY-MM-DD.json */
export async function featuresPath(day: string): Promise<string> {
  return `${await baseDir()}/footprint/features/${day}.json`;
}

/* ── 月缓存(LRU 3 个月;写侧标脏,读侧 getMonth 共享) ── */

interface MonthCacheEntry {
  data: FootprintMonthFile;
  dirty: boolean;
}

const monthCache = new Map<string, MonthCacheEntry>();

function cachePut(ym: string, entry: MonthCacheEntry): void {
  monthCache.delete(ym);
  monthCache.set(ym, entry);
  const oldest = monthCache.keys().next();
  if (monthCache.size > 3 && !oldest.done) monthCache.delete(oldest.value);
}

/** 读当月 rollup:缓存命中不落盘;未命中宽容读(不存在/损坏 = 空月)。 */
export async function getMonth(ym: string): Promise<FootprintMonthFile> {
  const hit = monthCache.get(ym);
  if (hit) {
    cachePut(ym, hit); /* 触碰即刷新 LRU 序 */
    return hit.data;
  }
  const data = await readMonth(ym);
  cachePut(ym, { data, dirty: false });
  return data;
}

async function readMonth(ym: string): Promise<FootprintMonthFile> {
  try {
    const parsed = JSON.parse(await ipc.fsReadFile(await monthPath(ym))) as FootprintMonthFile;
    if (parsed && parsed.version === 1 && parsed.days) return parsed;
  } catch {
    /* 文件不存在/损坏 = 空月(数据文件宽容读) */
  }
  return emptyMonth();
}

/* ── merge(纯函数,归日键 = 封口时刻) ── */

/** 把封口批并入单日聚合:files 按 path 累加 ±,refs 并集含该会话;sessions 记
 *  engine/cwd、turns 追加批次、first/last 取时间两端;batches 记最近批 id。 */
export function mergeBatchIntoDay(day: FootprintDay, batch: CkptBatch, cwd: string): void {
  const sid = batch.sessionId;
  const settleMs = batch.tsEnd ?? batch.ts;
  const settleIso = new Date(settleMs).toISOString();
  const startIso = new Date(batch.ts).toISOString();

  const sess = day.sessions[sid];
  if (sess) {
    if (!sess.turns.includes(batch.index)) sess.turns.push(batch.index);
    if (startIso < sess.first) sess.first = startIso;
    if (settleIso > sess.last) sess.last = settleIso;
  } else {
    day.sessions[sid] = { engine: batch.engine, cwd, turns: [batch.index], first: startIso, last: settleIso };
  }

  for (const f of batch.files) {
    const cur = day.files[f.path] ?? { add: 0, del: 0, cfg: isCfgPath(f.path), refs: [] };
    cur.add += f.additions;
    cur.del += f.deletions;
    if (!cur.refs.includes(sid)) cur.refs.push(sid);
    day.files[f.path] = cur;
  }

  day.batches[sid] = batch.id;
}

/* ── 单飞写队列:并发封口串行落盘,同进程无并发覆写 ── */

let queue: Promise<void> = Promise.resolve();

async function handleSealed(e: CkptTurnSealedEvent): Promise<void> {
  const list = await ipc.checkpointList(e.cwd, e.sessionId, e.tmdSessionId);
  /* 取最新批:清单首条且须已封口、会话匹配(代封/异会话不收) */
  const batch = list.find((b) => !b.open && b.sessionId === e.sessionId);
  if (!batch) return;
  const { ym, dd } = settleKey(batch.tsEnd ?? batch.ts);
  const month = await getMonth(ym);
  const day = month.days[dd] ?? emptyDay();
  mergeBatchIntoDay(day, batch, e.cwd);
  month.days[dd] = day;
  cachePut(ym, { data: month, dirty: true });
  await writeMonth(ym, month);
  cachePut(ym, { data: month, dirty: false });
}

async function writeMonth(ym: string, data: FootprintMonthFile): Promise<void> {
  const path = await monthPath(ym);
  await ensureParentDir(path);
  await ipc.fsWriteFile(path, JSON.stringify(data, null, 1));
}

/** activate 装配:订阅封口事件,串行消费。返回退订。 */
export function activateRollup(events: PluginEventBus): () => void {
  return events.on<CkptTurnSealedEvent>(KernelTopics.ckptTurnSealed, (e) => {
    queue = queue
      .then(() => handleSealed(e))
      .catch((err: unknown) => {
        /* 单轮失败不毁链:下轮封口仍能落盘 */
        console.warn("[footprint] rollup 落盘失败", err);
      });
  });
}

/** 仅供测试:等待串行队列排空。 */
export function rollupIdle(): Promise<void> {
  return queue.then(() => undefined);
}

/** 仅供测试:清空月缓存。 */
export function resetMonthCache(): void {
  monthCache.clear();
}

/* ── 补账(2026-10-20):本模块纯事件驱动 —— 只在应用运行且已订阅时收封口批,
 * 应用未运行期间封好的批次永远进不了月账(实证:卡引用的会话账本有批、月账全月无它)。
 * 补账入口把「账上已有、月账没有」的封口批幂等并入,以会话轮次号判重。 */

/** 待补项:已封口批次 + 其 cwd(账本目录键 = md5(cwd),cwd 错则读不到账本)。 */
export interface BackfillItem {
  batch: CkptBatch;
  cwd: string;
}

/** 幂等并入补账项:同会话同轮次已在账即跳过(重封不重算),有并入才落盘。
 *  返回并入批次数(0 = 账已齐)。
 *  走与封口落盘同一条单飞队列:两条路径都是「读月档→改→写」,并行会互相覆写丢批。 */
export async function backfillBatches(ym: string, items: BackfillItem[]): Promise<number> {
  const run = queue.then(() => mergeBackfill(ym, items));
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function mergeBackfill(ym: string, items: BackfillItem[]): Promise<number> {
  if (!items.length) return 0;
  const month = await getMonth(ym);
  let merged = 0;
  for (const { batch, cwd } of items) {
    const { ym: batchYm, dd } = settleKey(batch.tsEnd ?? batch.ts);
    if (batchYm !== ym) continue;
    const day = month.days[dd] ?? emptyDay();
    if (day.sessions[batch.sessionId]?.turns.includes(batch.index)) continue;
    mergeBatchIntoDay(day, batch, cwd);
    month.days[dd] = day;
    merged += 1;
  }
  if (!merged) return 0;
  cachePut(ym, { data: month, dirty: true });
  await writeMonth(ym, month);
  cachePut(ym, { data: month, dirty: false });
  return merged;
}

/* ── 用户修正覆盖层(spec 管线 D,v2 差量语义 2026-10-20):
 * .user.json = { version:2, overrides(按 AI 原标题覆盖), hidden(tombstone), added }。
 * 早期手动卡不再整量吞掉后到的 AI 归纳卡;重命名/隐藏/合并/拆分/手动
 * 全部由 useFpFix 以 AI 原档为基底重算差分写入(纯函数见 userLayer.ts)。 */

/** 保存当日修正差量层(整量覆写 .user.json,v2 差量档:对 AI 原档不整吞)。 */
export async function saveUserCards(day: string, layer: UserCardsFile): Promise<void> {
  const path = (await featuresPath(day)).replace(/\.json$/, ".user.json");
  await ensureParentDir(path);
  await ipc.fsWriteFile(path, JSON.stringify(layer, null, 1));
}
