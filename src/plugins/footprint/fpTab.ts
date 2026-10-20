/**
 * footprint · 中央 tab 契约与打开封装(纯函数自 index.tsx 拆出守
 * only-export-components,先例 anim/animStores)。
 * 另含 live 刷新信号:ckptTurnSealed 订阅侧 bump,视图侧
 * useSyncExternalStore 触发当日轻刷新(不自己维护写路径)。
 */
import { useSyncExternalStore } from "react";
import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";
import { dayKeyOf } from "./dataSource";

/** 每日足迹中央 tab(kernel/tabs kind 路由注册表)。 */
export const FP_TAB_KIND = "footprint.daily";
export const FP_TAB_ID = "footprint-daily";

/** 深链 payload:day = "YYYY-MM-DD"(dayKeyOf 同格式零填充);缺省开今日。 */
export interface FootprintTabPayload {
  day?: string;
}

/** 打开/激活足迹 tab(侧栏入口与 journal 轴视图深链共用;openTab 幂等)。
 *  refresh 显式 opt-in:已开 tab 刷 payload 并激活 —— 深链换日重开即跟跳,
 *  视图侧 FootprintView 消费 payload(render 期比较,先例 useArticleEditSignal)。 */
export function openFootprintTab(opts?: FootprintTabPayload): void {
  openTab(
    {
      id: FP_TAB_ID,
      kind: FP_TAB_KIND,
      title: t("每日足迹"),
      path: "footprint",
      payload: (opts ?? {}) satisfies FootprintTabPayload,
    },
    { refresh: true },
  );
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
