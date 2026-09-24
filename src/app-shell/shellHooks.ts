// AppShell 持久化开关与元素宽度测量 hook,自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

export function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(key) !== "0" && initial,
  );
  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);
  return [open, () => setOpen((v) => !v), setOpen] as const;
}

/** 最大化下侧栏手动拖拽(钉宽 var + panelRef 双通道;非最大化返回 no-op 交库原生)。 */
export function asideDragFactory(
  maximized: boolean,
  leftPanelRef: { current: { resize: (px: number) => void } | null },
  rightPanelRef: { current: { resize: (px: number) => void } | null },
) {
  return (e: ReactPointerEvent<HTMLElement>, side: "left" | "right") => {
    if (!maximized) return;
    e.preventDefault();
    const varName = side === "left" ? "--tmd-left-aside-w" : "--tmd-right-aside-w";
    const panel = (side === "left" ? leftPanelRef : rightPanelRef).current;
    const startX = e.clientX;
    const startW =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName)) || 240;
    const sign = side === "left" ? 1 : -1;
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(startW + sign * (ev.clientX - startX));
      const clamped = Math.min(Math.max(160, w), Math.round(window.innerWidth * 0.6));
      document.documentElement.style.setProperty(varName, `${clamped}px`);
      panel?.resize(clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}

/** 经典滚动条吃掉内容宽度:实测一次写 CSS 变量,供顶栏折叠按钮让位对齐。 */
export function useScrollbarProbe() {
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:-99px;left:-99px;width:100px;height:100px;overflow:scroll";
    document.body.appendChild(probe);
    document.documentElement.style.setProperty(
      "--tmd-scrollbar-w",
      `${probe.offsetWidth - probe.clientWidth}px`,
    );
    probe.remove();
  }, []);
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
