/**
 * 手势失败轻提示状态源 —— server 起/初始化失败、无语言服务文件的首次手势
 * 两条出口共用(cmLsp 触发,gestureToast 呈现)。组件文件不能出非组件导出
 * (react-doctor only-export-components),故独立于 tsx。
 *
 * 节流(60s):hover 每次移动都会 ensureSync,失败若不节流会刷屏;
 * 两条出口各持独立时间槽,互不挤占。noticeDue 为纯函数(单测锚点)。
 */

import { createSubscribable } from "@kernel/subscribable";

/** 节流窗:同一出口 60s 内只弹一次。 */
export const GESTURE_NOTICE_THROTTLE_MS = 60_000;

/** 出口键:server 失败 / 无语言服务。 */
export type GestureNoticeKey = "server-error" | "no-language";

export interface GestureNoticeState {
  /** 各出口最近一次上屏时刻(ms;null = 从未)。 */
  lastShownAt: Record<GestureNoticeKey, number | null>;
  /** 当前提示(seq 递增驱动 toast 重挂重计时);null = 无。 */
  notice: { seq: number; message: string } | null;
}

/**
 * 纯函数:该出口的提示是否到期。lastShownAt 为 null(从未弹过)或距 nowMs
 * 已满 throttleMs 时到期;边界值(恰等于节流窗)视为到期。
 */
export function noticeDue(
  lastShownAt: Record<GestureNoticeKey, number | null>,
  key: GestureNoticeKey,
  nowMs: number,
  throttleMs: number = GESTURE_NOTICE_THROTTLE_MS,
): boolean {
  const last = lastShownAt[key];
  return last === null || nowMs - last >= throttleMs;
}

const store = createSubscribable<GestureNoticeState>({
  lastShownAt: { "server-error": null, "no-language": null },
  notice: null,
});
let seq = 0;

/** 手势失败提示(节流内静默):到期才上屏并记时间槽。 */
export function showGestureNotice(
  key: GestureNoticeKey,
  message: string,
  nowMs: number = Date.now(),
): void {
  const snap = store.snapshot;
  if (!noticeDue(snap.lastShownAt, key, nowMs)) return;
  store.commit({
    lastShownAt: { ...snap.lastShownAt, [key]: nowMs },
    notice: { seq: ++seq, message },
  });
}

/** 非 React 读取(测试/调试用);React 订阅走 useGestureNotice。 */
export function gestureNoticeSnapshot(): GestureNoticeState {
  return store.snapshot;
}

/** React 订阅:当前提示(notice 为稳定引用,select 切片合规)。 */
export function useGestureNotice(): GestureNoticeState["notice"] {
  return store.useStore((snap) => snap.notice);
}

/** 测试复位:清时间槽与当前提示(仅测试消费,产品代码不调用)。 */
export function resetGestureNoticeForTest(): void {
  store.commit({ lastShownAt: { "server-error": null, "no-language": null }, notice: null });
}
