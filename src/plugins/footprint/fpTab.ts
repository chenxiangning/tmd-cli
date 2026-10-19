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

/** 打开/激活足迹 tab(侧栏入口共用;openTab 幂等语义)。 */
export function openFootprintTab(): void {
  openTab({
    id: FP_TAB_ID,
    kind: FP_TAB_KIND,
    title: t("每日足迹"),
    path: "footprint",
    payload: {},
  });
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
