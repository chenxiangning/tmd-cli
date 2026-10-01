/**
 * 弹层焦点圈闭 hook ── role="dialog" 弹层的键盘可达公共基件(五处同款副本
 * 收口;候选进一步统一进 DialogShell):激活时捕获容器节点,Tab 在可聚焦
 * 元素间循环;initialFocus=false 供调用方自带编程聚焦的弹层;失活/卸载
 * 还原进入前焦点。返回挂到弹层根节点的 ref。
 */
import { useEffect, useRef } from "react";

export function useFocusTrap(
  active: boolean,
  initialFocus = true,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    /* 节点 effect 期捕获,cleanup 用捕获值(卸载前节点即本帧节点,
       免 cleanup 读 ref.current 的换节点错位告警)。 */
    const node = ref.current;
    if (!node) return;
    const restore = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    if (initialFocus) focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      restore?.focus?.();
    };
  }, [active, initialFocus]);
  return ref;
}
