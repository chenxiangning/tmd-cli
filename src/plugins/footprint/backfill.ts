/**
 * footprint 补账(2026-10-20):rollup 是纯事件驱动 —— 封口事件只在应用运行且
 * 已订阅时到达;应用未运行期间封好的批次永远进不了月账。实证:功能卡引用的
 * 会话在 checkpoint ledger 有批,月账却全月无此会话 → 卡面「0 文件」,用户判
 * 「自动数据接入没生效」。
 *
 * 口径(只补不猜):
 * ① 候选 = 会话清单里本月有活动的会话;判「要不要查账」按**逐日活动日**——活动日内
 *    任一天在月账里没有该会话就查(跨零点的次日漏账不会被「已在别的日出现」跳过);
 * ② cwd 由工作区注册表解析(账本目录键 = md5(cwd),读不到账本即跳过该会话);
 * ③ 只补已封口批,按轮次号幂等判重(重封不重算);
 * ④ 单会话失败不毁全局(与会话无账本 / cwd 不符同义)。
 *
 * 触发点 = 首次打开足迹视图(不在启动后定时跑):对账要全量会话扫描,叠在启动
 * 峰上会与「启动错峰」目标冲突;用户看数据的那一刻补,补到即 bump 重拉。
 */
import { ipc, type CkptBatch } from "@kernel/ipc";
import { getWorkspaces } from "@kernel/workspace";
import { loadSessionRows, type DaySessionRow } from "./dataSource";
import { bumpFootprintRev } from "./fpTab";
import { backfillBatches, getMonth } from "./rollup";
import { pad2, settleKey, type FootprintMonthFile } from "./types";

/** 待对账会话:会话 id + 工作区根(作 cwd)+ 本月活动日(逐日判缺口)。 */
export interface Candidate {
  sid: string;
  cwd: string;
  /** 本月活动日 "DD"(按 startedAt..modifiedAt 区间裁进本月;已去重升序)。 */
  days: string[];
}

/** 时刻 → 月键 YYYY-MM(本地时区,与 settleKey 同源)。 */
export function monthKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 当月活动日:区间裁进本月,跨度跨月也只在月内取值。 */
export function activeDaysOf(startedAt: number, modifiedAt: number, ym: string): string[] {
  const start = new Date(Math.min(startedAt, modifiedAt));
  const end = new Date(Math.max(startedAt, modifiedAt));
  const days: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  /* 上界 = 结束日 + 1 天(半开);跨年由 Date 归一,最多 31 次循环。 */
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime();
  while (cursor.getTime() < stop) {
    if (monthKeyOf(cursor.getTime()) === ym) days.push(pad2(cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** 本月候选会话去重(同一会话多行取活动日并集;cwd 解析不出即弃)。 */
export function candidatesFor(
  rows: readonly DaySessionRow[],
  rootOf: (wsId?: string) => string | null,
  ym: string,
): Candidate[] {
  const bySid = new Map<string, Candidate>();
  for (const r of rows) {
    const sid = r.id;
    if (!sid) continue;
    const cwd = rootOf(r.wsId);
    if (!cwd) continue;
    const days = activeDaysOf(r.startedAt, r.modifiedAt, ym);
    if (!days.length) continue;
    const cur = bySid.get(sid);
    if (!cur) {
      bySid.set(sid, { sid, cwd, days });
    } else {
      const have = new Set(cur.days);
      for (const dd of days) if (!have.has(dd)) { have.add(dd); cur.days.push(dd); }
      cur.days.sort();
    }
  }
  return [...bySid.values()];
}

/** 是否要查该会话的账:活动日内任一天在月账里缺该会话(逐日判,不全局跳过)。 */
export function needsCheck(month: FootprintMonthFile, c: Candidate): boolean {
  return c.days.some((dd) => !month.days[dd]?.sessions[c.sid]);
}

/** 可补批:已封口 + 会话匹配 + 封口时刻落在本月(open 批未定型,不补)。 */
export function pickBatches(list: readonly CkptBatch[], sid: string, ym: string): CkptBatch[] {
  return list.filter((b) => !b.open && b.sessionId === sid && settleKey(b.tsEnd ?? b.ts).ym === ym);
}

/** 对本月补账一次;返回并入批次数(0 = 账已齐 / 无可补数据)。 */
export async function reconcileMonth(ym: string): Promise<number> {
  const [{ rows }, month] = await Promise.all([loadSessionRows(), getMonth(ym)]);
  const roots = new Map(getWorkspaces().map((w) => [w.id, w.root]));
  const todo = candidatesFor(rows, (id) => (id ? roots.get(id) ?? null : null), ym)
    .filter((c) => needsCheck(month, c));
  if (!todo.length) return 0;
  /* 读账只读并行(Rust 侧账本锁自串行);单会话失败跳过,不毁全局 */
  const items = (
    await Promise.all(
      todo.map(async (c) => {
        try {
          return pickBatches(await ipc.checkpointList(c.cwd, c.sid), c.sid, ym).map((b) => ({ batch: b, cwd: c.cwd }));
        } catch {
          return [];
        }
      }),
    )
  ).flat();
  return backfillBatches(ym, items);
}

/* ── 视图侧触发:进程内只对账一次(单次闸,补到即 bump 视图重拉) ── */

let reconciled = false;

/** 首次打开足迹视图时调;重复调用只走一次(失败不重试,下个版本进程再试)。 */
export async function reconcileOnce(): Promise<number> {
  if (reconciled) return 0;
  reconciled = true;
  try {
    const n = await reconcileMonth(monthKeyOf(Date.now()));
    if (n > 0) bumpFootprintRev();
    return n;
  } catch {
    return 0;
  }
}

/** 仅供测试:复位单次闸。 */
export function resetReconcileOnce(): void {
  reconciled = false;
}
