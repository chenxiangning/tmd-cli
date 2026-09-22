// AppShell 持久化开关与元素宽度测量 hook,自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { useEffect, useState } from "react";

export function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(key) !== "0" && initial,
  );
  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);
  return [open, () => setOpen((v) => !v), setOpen] as const;
}

/** 窄屏(手机)断点判定:matchMedia 订阅,默认 768px。 */
export function useIsNarrow(maxPx = 768): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= maxPx,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [maxPx]);
  return narrow;
}
/**
 * 测量元素宽度并直写 CSS 变量(随拖动实时更新)。
 * 直写 var 而非 setState:分栏拖动每帧触发,避免顶栏整树重渲染(顶栏经 var() 消费);
 * 元素卸载时移除变量 —— 消费端 var() 无回退即 computed-value 无效,退化 auto(= 旧 0=未测量语义)。
 * 0 宽不写盘:历史版本 .group-maximized 曾把侧栏样式折叠到零宽,写 0 会把
 * 顶栏左区挤成 4px 让按钮溢出(现最大化已改为钉宽,守卫保留兜底);卸载
 * 路径(栏关闭)变量本就整体移除,无此问题。frozen(最大化钉宽期)停写:
 * 宽度由 var 钉出,回写即自反馈,瞬态小宽度会被钉死(见函数内注释)。
 */
export function useElementWidth(cssVar: string, frozen = false) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  /* RO 订阅:frozen 进 deps 直接重建(无 ref 桥)。清理只断观察、不摘 var ——
     最大化切变时 var 正是钉宽来源,摘除会塌回 18% 兜底。 */
  useEffect(() => {
    if (!el) return;
    let lastWidth = -1;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      /* 冻结期(编辑区最大化)不写:此时宽度本就由 var 钉出,回写是自反馈——
         窗口 resize 的瞬态小宽度(实测 1px)会被钉成永久。 */
      if (frozen || w === lastWidth || w <= 0) return;
      lastWidth = w;
      document.documentElement.style.setProperty(cssVar, `${w}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, cssVar, frozen]);
  /* var 生命周期单独管理:仅在元素卸载(栏关闭)时移除,避免残留旧宽度。 */
  useEffect(() => {
    if (!el) document.documentElement.style.removeProperty(cssVar);
  }, [el, cssVar]);
  /* setEl 引用恒定,直接当 callback ref 用(attach/detach 即 el/null)。 */
  return setEl;
}
