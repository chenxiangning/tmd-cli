/**
 * composer 输入框高度(taH):null = 紧凑态(随内容 34–132 自长高,逻辑在 Composer);
 * 数字 = 拖拽固定高,内滚。顶部把手经 Pointer Events 驱动(触屏/鼠标一路,
 * setPointerCapture 保证移出把手仍收 move,合成事件/旧引擎失败不碍主路);
 * 拖动中只改状态不落盘,落手一次持久化(localStorage,kbOn 同款)。
 * 2026-10-03 三态胶囊重做时曾随把手删除,同日应大仙要求保真回归。
 */
import React, { useState } from "react";

export const TA_MIN_H = 48;
export const TA_MAX_H = 320;

const H_KEY = "tmd.composer.h";

export function useComposerSize(taRef: React.RefObject<HTMLTextAreaElement | null>): {
  taH: number | null;
  /** 拖拽进行中(把手加深反馈;SessionScreen 传 className)。 */
  dragging: boolean;
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
      return Number.isFinite(v) && v >= TA_MIN_H && v <= TA_MAX_H ? v : null;
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
  const [dragging, setDragging] = useState(false);
  /* 双击把手 = 回紧凑态(两次按下 <300ms;可发现性:把手除了拖还能点两下)。 */
  const lastTapAt = React.useRef(0);
  const down = (e: React.PointerEvent): void => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* 合成事件无有效 pointerId */ }
    const now = Date.now();
    if (now - lastTapAt.current < 300) {
      lastTapAt.current = 0;
      grab.current = null;
      setTaH(null);
      return;
    }
    lastTapAt.current = now;
    const h0 = taH ?? (taRef.current?.offsetHeight ?? TA_MIN_H);
    cur.current = h0;
    grab.current = { y: e.clientY, h: h0 };
    setDragging(true);
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
    setDragging(false);
    const h = cur.current;
    /* 拉到下限以下松手 = 回紧凑态(随内容自长高),记忆一并清掉 */
    setTaH(h !== null && h <= TA_MIN_H ? null : h);
  };
  return { taH, dragging, grabHandlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}

/** iOS 交互式键盘收起(下滑手势/滚动收起)有不触发 blur 的形态,kbOpen 滞留
 * true → 键条整行持续隐藏(2026-10-04 留观;双端无害:Android 本就 blur)。
 * 兜底:visualViewport 高度回满 ≈ 键盘已收,强制清位。 */
export function useKeyboardDismissFallback(onDismiss: () => void) {
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (vv.height >= window.innerHeight - 8) onDismiss();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [onDismiss]);
}
