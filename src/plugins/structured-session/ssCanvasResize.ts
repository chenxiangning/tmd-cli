/**
 * RPC 幕布宽度拖拽 —— 左右抓手对称调宽(居中锚:width = 2×|pointerX−中轴|),
 * 夹取 40%~100%,默认 85%(2026-11-05 用户裁决:860px 定宽在宽屏左右太空)。
 * 松手落 localStorage(键 tmd.ss.canvasW,百分值);pointer 起拖 + window
 * 监听与 ssComposerResize 同律。左右抓手同一映射(对称,无需分左右 handler)。
 */
import { useState, type PointerEvent as ReactPointerEvent } from "react";

const MIN_PCT = 40;
const MAX_PCT = 100;
const DEFAULT_PCT = 85;
const STORAGE_KEY = "tmd.ss.canvasW";

function clampPct(v: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, v));
}

function readInitial(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(v) && v >= MIN_PCT && v <= MAX_PCT) return v;
  } catch { /* 存储失效退化默认 */ }
  return DEFAULT_PCT;
}

export function useCanvasWidth(): {
  widthPct: number;
  onHandleDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const [widthPct, setWidthPct] = useState(readInitial);
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    /* 中轴取滚动区(.ss-scroll,幕布恒居中相对它);rect 在起拖时取一次,
     * 拖动期间窗口尺寸变化不追(松手后再拖即按新中轴)。 */
    const rect = e.currentTarget.closest(".ss-scroll")?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const half = rect.width / 2;
    const toPct = (clientX: number) => clampPct((Math.abs(clientX - centerX) / half) * 100);
    const onMove = (ev: PointerEvent) => setWidthPct(toPct(ev.clientX));
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const v = Math.round(toPct(ev.clientX));
      setWidthPct(v);
      try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* 存储失效退化会话内 */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return { widthPct, onHandleDown };
}
