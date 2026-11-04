/**
 * 对话框拖拽调高 —— 从 SsComposer 拆出(复杂度出件)。pointer 起拖,
 * 纵向位移调 textarea 上限(上拖增高,96~520 夹取),松手落 localStorage。
 */
import { useState } from "react";

const MIN_H = 96;
const MAX_H = 520;

function clampH(v: number): number {
  return Math.min(MAX_H, Math.max(MIN_H, v));
}

export function useComposerResize(): {
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
    const onMove = (ev: PointerEvent) => setComposerH(clampH(startH + (startY - ev.clientY)));
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try { localStorage.setItem("tmd.ss.composerH", String(clampH(startH + (startY - ev.clientY)))); } catch { /* 存储失效退化会话内 */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return { composerH, onHandlePointerDown };
}
