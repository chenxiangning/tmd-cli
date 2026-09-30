/**
 * composer 输入框高度(taH):null = 紧凑态(随内容 48–144 自长高,逻辑在 SessionScreen);
 * 数字 = 拖拽固定高,内滚。顶部把手经 Pointer Events 驱动(触屏/鼠标一路,
 * setPointerCapture 保证移出把手仍收 move,合成事件/旧引擎失败不碍主路);
 * 拖动中只改状态不落盘,落手一次持久化(localStorage,kbOn 同款)。
 */
import React, { useState } from "react";

export const TA_MIN_H = 48;
export const TA_MAX_H = 320;

const H_KEY = "tmd.composer.h";

export function useComposerSize(taRef: React.RefObject<HTMLTextAreaElement | null>): {
  taH: number | null;
  grabHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
} {
  const [taH, setTaHState] = useState<number | null>(() => {
    try {
      const v = parseInt(localStorage.getItem(H_KEY) ?? "", 10);
      return Number.isFinite(v) && v >= TA_MIN_H ? v : null;
    } catch {
      return null;
    }
  });
  const setTaH = (v: number | null): void => {
    setTaHState(v);
    try {
      if (v === null) localStorage.removeItem(H_KEY);
      else localStorage.setItem(H_KEY, String(v));
    } catch { /* 隐私态 */ }
  };

  /* 拖拽会话内的实时高度:事件期落 ref(渲染期变 ref 挨 react-doctor;move→up 同步,
   * 不经 React 提交,免连续事件批处理的滞后)。 */
  const cur = React.useRef<number | null>(null);
  const grab = React.useRef<{ y: number; h: number } | null>(null);
  const down = (e: React.PointerEvent): void => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* 合成事件无有效 pointerId */ }
    const h0 = taH ?? (taRef.current?.offsetHeight ?? TA_MIN_H);
    cur.current = h0;
    grab.current = { y: e.clientY, h: h0 };
  };
  const move = (e: React.PointerEvent): void => {
    if (!grab.current) return;
    const h = Math.min(TA_MAX_H, Math.max(TA_MIN_H, grab.current.h + (grab.current.y - e.clientY)));
    cur.current = h;
    setTaHState(h);
  };
  const up = (): void => {
    if (!grab.current) return;
    grab.current = null;
    const h = cur.current;
    /* 拉到下限以下松手 = 回紧凑态(随内容自长高),记忆一并清掉 */
    setTaH(h !== null && h <= TA_MIN_H ? null : h);
  };
  return { taH, grabHandlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}
