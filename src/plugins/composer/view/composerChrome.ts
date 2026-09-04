/**
 * Composer 弹窗锚定与拖拽判定(从 Composer 拆出,单文件 ≤500 行铁则)。
 *
 * - usePopupAnchor:弹窗统一悬在对话框上方 —— portal + fixed 跳出 Panel 的
 *   overflow:hidden 裁切,锚定几何随对话框盒子实时量测(拖拽分隔条/窗口缩放均触发)。
 * - useAttachDragProps:悬停高亮只认 composer 能收的拖拽(外部文件 Files 或
 *   文件树内部拖拽 payload);附件条重排(纯 text/plain)不弹遮罩,避免重排时闪烁。
 */

import { useEffect, useState, type RefObject } from "react";

export interface PopupAnchor {
  boxRect: DOMRect | null;
  /** 面板底缘 = 对话框顶缘上方 8px(fixed bottom 值)。 */
  popupBottom: number;
  /** 向上生长的封顶:视口上缘呼吸位内,最高 420px。 */
  popupMaxHeight: number;
}

export function usePopupAnchor(composerRef: RefObject<HTMLElement | null>): PopupAnchor {
  const [boxRect, setBoxRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const update = () => setBoxRect(el.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [composerRef]);
  return {
    boxRect,
    popupBottom: boxRect ? window.innerHeight - boxRect.top + 8 : 0,
    popupMaxHeight: boxRect ? Math.max(160, Math.min(420, boxRect.top - 24)) : 160,
  };
}

export function useAttachDragProps(
  composerRef: RefObject<HTMLElement | null>,
  readDragPayload: () => unknown,
  setDragOver: (v: boolean) => void,
) {
  function isAttachDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files") || readDragPayload() !== null;
  }
  return {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      if (isAttachDrag(e)) setDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      /* 子元素间移动也派发 dragleave(relatedTarget = 将进入的元素);
         只有真正离开 composer 边界(含拖出窗口,relatedTarget 为 null)才撤遮罩 */
      if (!composerRef.current?.contains(e.relatedTarget as Node | null)) setDragOver(false);
    },
  };
}
