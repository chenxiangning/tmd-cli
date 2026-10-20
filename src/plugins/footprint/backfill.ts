/**
 * footprint 补账(2026-10-20):rollup 是纯事件驱动 —— 封口事件只在应用运行且
 * 已订阅时到达;应用未运行期间封好的批次永远进不了月账。实证:功能卡引用的
 * 会话在 checkpoint ledger 有批,月账却全月无此会话 → 卡面「0 文件」,用户判
 * 「自动数据接入没生效」。
 *
 * 口径(只补不猜):
 * ① 候选 = 会话清单里本月有活动的会话;月账已有该会话即跳过(后续批由事件续上);
 * ② cwd 由工作区注册表解析(账本目录键 = md5(cwd),读不到账本即跳过该会话);
 * ③ 只补已封口批,按轮次号幂等判重;
 * ④ 单会话失败不毁全局(与会话无账本 / cwd 不符同义)。
 */
import { ipc, type CkptBatch } from "@kernel/ipc";
import { getWorkspaces } from "@kernel/workspace";
import { loadSessionRows, type DaySessionRow } from "./dataSource";
import { backfillBatches, getMonth, type BackfillItem } from "./rollup";
import { pad2, settleKey, type FootprintMonthFile } from "./types";

/** 待对账会话:会话 id + 其工作区根(作 cwd 喂账本查询)。 */
export interface Candidate {
  sid: string;
  cwd: string;
}

/** 时刻 → 月键 YYYY-MM(本地时区,与 settleKey 同源)。 */
export function monthKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 本月候选会话去重(同一会话多行只取一次;cwd 解析不出即弃)。 */
export function candidatesFor(
  rows: readonly DaySessionRow[],
  rootOf: (wsId?: string) => string | null,
  ym: string,
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const sid = r.id;
    if (!sid || seen.has(sid)) continue;
    const cwd = rootOf(r.wsId);
    if (!cwd) continue;
    if (monthKeyOf(r.startedAt) !== ym && monthKeyOf(r.modifiedAt) !== ym) continue;
    seen.add(sid);
    out.push({ sid, cwd });
  }
  return out;
}

/** 月账是否已记过该会话(任一有会话即算;不按月账内容推断缺口批)。 */
export function accounted(month: FootprintMonthFile, sid: string): boolean {
  for (const day of Object.values(month.days)) if (day.sessions[sid]) return true;
  return false;
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
    .filter((c) => !accounted(month, c.sid));
  if (!todo.length) return 0;
  const items: BackfillItem[] = [];
  for (const c of todo) {
    try {
      const list = await ipc.checkpointList(c.cwd, c.sid);
      for (const b of pickBatches(list, c.sid, ym)) items.push({ batch: b, cwd: c.cwd });
    } catch {
      /* 单会话读账失败 = 跳过该会话(无账本 / cwd 不符),不毁全局 */
    }
  }
  return backfillBatches(ym, items);
}
