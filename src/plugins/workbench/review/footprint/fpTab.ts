/**
 * footprint · 回顾二级视图契约与打开封装(纯函数自旧插件 index 拆出守
 * only-export-components,先例 anim/animStores;C-02 随视图迁入
 * workbench/review/footprint,旧 @plugins/footprint/fpTab 为纯 re-export 兼容层)。
 * 另含 live 刷新信号:ckptTurnSealed 订阅侧 bump,视图侧
 * useSyncExternalStore 触发当日轻刷新(不自己维护写路径)。
 *
 * 深链(C-02 起):打开 = 「回顾」主 tab 的足迹二级视图
 * (reviewTabs.openWorkbenchReviewTab,{view:"footprint", day}),旧 footprint.daily
 * kind 仅由工作台注册兼容渲染历史 tab(见 workbench LegacyFootprintTab)。
 */
import { useSyncExternalStore } from "react";
import { openWorkbenchReviewTab } from "../reviewTabs";
import { dayKeyOf } from "./dataSource";

/** 旧中央 tab kind/id(C-02 起仅工作台兼容渲染历史 tab 使用;深链走回顾壳)。 */
export const FP_TAB_KIND = "footprint.daily";
export const FP_TAB_ID = "footprint-daily";

/** 深链 payload:day = "YYYY-MM-DD"(dayKeyOf 同格式零填充);缺省开今日。 */
export interface FootprintTabPayload {
  day?: string;
}

/** 打开/激活「回顾 → 每日足迹」二级视图(侧栏入口与 journal 轴视图深链共用;
 *  openTab 幂等 + refresh 显式重开:已开时刷 payload 并激活,深链换日即跟跳)。
 *  旧 footprint.daily 中央 tab 深链由工作台兼容层承接(见 workbench/index)。 */
export function openFootprintTab(opts?: FootprintTabPayload): void {
  openWorkbenchReviewTab({ view: "footprint", day: opts?.day });
}

/** payload.day → {y,m};缺省/非法(NaN、月日出界)→ null(调用方回落今日)。 */
export function fpYmOfDay(day: string | undefined): { y: number; m: number } | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m } : null;
}

/** 深链初始视图态:payload.day 合法 → 停该日;非法/缺省 → 今日(today 恒为
 *  dayKeyOf 产物,兜底分支防御性存在)。 */
export function fpInitView(day: string | undefined, today: string): { ym: { y: number; m: number }; sel: string } {
  const ym = fpYmOfDay(day);
  if (day && ym) return { ym, sel: day };
  return { ym: fpYmOfDay(today) ?? { y: 1970, m: 1 }, sel: today };
}

/* ── live 刷新信号(模块级 ref 桥,先例 kernel/shortcuts 的模块级桥) ── */

let rev = 0;
const subs = new Set<() => void>();

/** ckptTurnSealed 订阅侧调用:标脏并通知视图轻刷新。 */
export function bumpFootprintRev(): void {
  rev++;
  for (const s of subs) s();
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** 视图订阅:封口事件到达即变化,驱动当日数据重拉。 */
export function useFootprintRev(): number {
  return useSyncExternalStore(subscribe, () => rev);
}

/** 回到今日动作(顶栏按钮与 t 键共用;纯函数自 FpTopbar 拆出守 only-export-components)。 */
export function gotoToday(
  setYm: (ym: { y: number; m: number }) => void,
  setSel: (day: string) => void,
): void {
  const d = new Date();
  setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
  setSel(dayKeyOf(d));
}
