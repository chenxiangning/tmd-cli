// AppShell 持久化开关与元素宽度测量 hook,自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { useCallback, useEffect, useRef, useState } from "react";

export function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(key) !== "0" && initial,
  );
  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);
  return [open, () => setOpen((v) => !v), setOpen] as const;
}
/**
 * 测量元素宽度并直写 CSS 变量(随拖动实时更新)。
 * 直写 var 而非 setState:分栏拖动每帧触发,避免顶栏整树重渲染(顶栏经 var() 消费);
 * 元素卸载时移除变量 —— 消费端 var() 无回退即 computed-value 无效,退化 auto(= 旧 0=未测量语义)。
 */
export function useElementWidth(cssVar: string) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const lastWidthRef = useRef(-1);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el) {
        lastWidthRef.current = -1;
        document.documentElement.style.removeProperty(cssVar);
        return;
      }
      const ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w === lastWidthRef.current) return;
        lastWidthRef.current = w;
        document.documentElement.style.setProperty(cssVar, `${w}px`);
      });
      ro.observe(el);
      observerRef.current = ro;
    },
    [cssVar],
  );
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      document.documentElement.style.removeProperty(cssVar);
    },
    [cssVar],
  );
  return ref;
}
