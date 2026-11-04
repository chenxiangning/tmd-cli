/**
 * 对话框拖拽调高 —— 从 SsComposer 拆出(复杂度出件)。pointer 起拖,
 * 纵向位移调 textarea 上限(上拖增高,96~520 夹取)。拖动中经 applyH 回调
 * 把夹取值直接写进 textarea 行内高 —— 短草稿也即时变高,修「拖了没反应」
 * (旧实现只抬 max-height,scrollHeight 小时面板纹丝不动)。松手落
 * localStorage。
 */
import { useState } from "react";

const MIN_H = 96;
const MAX_H = 520;

function clampH(v: number): number {
  return Math.min(MAX_H, Math.max(MIN_H, v));
}

export function useComposerResize(applyH: (h: number) => void): {
  composerH: number;
  onHandlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
} {
  const [composerH, setComposerH] = useState(() => {
    try {
      const v = Number(localStorage.getItem("tmd.ss.composerH"));
      return Number.isFinite(v) && v >= MIN_H && v <= MAX_H ? v : 220;
    } catch { return 220; }
  });
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = composerH;
    const onMove = (ev: PointerEvent) => {
      const h = clampH(startH + (startY - ev.clientY));
      setComposerH(h);
      applyH(h);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const h = clampH(startH + (startY - ev.clientY));
      try { localStorage.setItem("tmd.ss.composerH", String(h)); } catch { /* 存储失效退化会话内 */ }
      applyH(h);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return { composerH, onHandlePointerDown };
}
