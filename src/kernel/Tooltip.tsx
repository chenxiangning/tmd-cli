/**
 * 委托式悬浮提示(HintProvider) —— 跨组件单例监听 + portal 渲染。
 *
 * 用法:任何元素加 `data-hint="文案"` 即可;若该元素映射到快捷键命令,加
 * `data-hint-cmd="命令 id"`,HintProvider 自动读取 effective 键位拼到文案右侧;
 * 静态键位可直传 `data-hint-shortcut="⌘K"`,绕过命令注册表查询。
 *
 * 触发:mouseenter/focusin ~300ms 显示,~120ms 隐藏;mouseleave/focusout 立即清;
 * Esc 关闭;scroll/resize 重定位;靠近视口上下边自动翻向。
 * 屏蔽:目标自带原生 `title` 显示(用 `data-hint` 替换);`data-hint-disabled="true"` 抑制。
 * 失败:命中后清空目标原生 title 防双层气泡(还原逻辑在 targetLost 里恢复)。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEffectiveKeybindingChips, useEffectiveKeybindingLabel } from "./shortcutOverrides";

const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 120;

interface HintTarget {
  el: HTMLElement;
  label: string;
  shortcut: string | null;
}

interface PopoverState {
  target: HintTarget;
  /** 浮层相对视口的左上角(已做视口夹取) */
  x: number;
  y: number;
  /** 箭头方向:bottom = 锚点下方(默认),top = 锚点上方 */
  placement: "top" | "bottom";
}

/**
 * 读 `data-hint` 系列属性,合成展示面(不查注册表的轻量入口;命令键位走子组件用
 * `useEffectiveKeybindingLabel` 订阅,避免每次 mouseover 全量重算注册表)。
 */
function readHintAttrs(el: HTMLElement): HintTarget | null {
  if (el.dataset.hintDisabled === "true") return null;
  const label = el.dataset.hint;
  if (!label) return null;
  return { el, label, shortcut: null };
}

/** 解析命令 id 的键位(空 = 无键位/未注册/match 型);挂在浮层里,React 订阅保证改键即时刷新。 */
function ShortcutNode({ cmdId }: { cmdId: string }) {
  const chips = useEffectiveKeybindingChips(cmdId);
  const label = useEffectiveKeybindingLabel(cmdId);
  if (!label) return null;
  // match 型(如 ⌘1-9)语法表达不了分段,整串单 chip 兜底
  const parts = chips ?? [label];
  return (
    <span className="hint-keys" aria-hidden>
      {parts.map((p, i) => (
        <kbd key={i} className="kbd-chip">
          {p}
        </kbd>
      ))}
    </span>
  );
}

function popoverFromTarget(target: HintTarget): PopoverState {
  const rect = target.el.getBoundingClientRect();
  const margin = 8;
  // 默认放在锚点下方,留出足够空间则不翻向
  const popW = 220; // 估值,真实宽以 rect 测得为准
  const popH = 36;
  const preferBottom = rect.bottom + popH + margin < window.innerHeight || rect.top > window.innerHeight / 2;
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8));
  const y = preferBottom
    ? Math.min(rect.bottom + margin, window.innerHeight - popH - 8)
    : Math.max(8, rect.top - popH - margin);
  return { target, x, y, placement: preferBottom ? "bottom" : "top" };
}

export function HintProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PopoverState | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);
  const origTitle = useRef<string | null>(null);
  const stateRef = useRef<PopoverState | null>(null);
  /* handler 经 ref 读最新 state:监听器只在挂载时绑一次,不随气泡显隐拆挂;
     ref 转交放 effect,避免渲染期写(React 渲染须纯)。 */
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    function clearTimers(): void {
      clearTimeout(showTimer.current ?? undefined);
      showTimer.current = null;
      clearTimeout(hideTimer.current ?? undefined);
      hideTimer.current = null;
    }

    function restoreTitle(): void {
      if (activeEl.current && origTitle.current !== null) {
        activeEl.current.setAttribute("title", origTitle.current);
        origTitle.current = null;
      }
    }

    function dismiss(): void {
      clearTimers();
      restoreTitle();
      activeEl.current = null;
      setState(null);
    }

    function show(el: HTMLElement, target: HintTarget): void {
      if (activeEl.current === el) return;
      restoreTitle();
      activeEl.current = el;
      const had = el.getAttribute("title");
      if (had !== null) {
        origTitle.current = had;
        el.setAttribute("title", "");
      }
      setState(popoverFromTarget(target));
    }

    function scheduleHide(): void {
      clearTimeout(hideTimer.current ?? undefined);
      hideTimer.current = window.setTimeout(dismiss, HIDE_DELAY_MS);
    }

    function scheduleShow(el: HTMLElement, target: HintTarget): void {
      clearTimeout(showTimer.current ?? undefined);
      clearTimeout(hideTimer.current ?? undefined);
      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        show(el, target);
      }, SHOW_DELAY_MS);
    }

    function onEnter(e: Event): void {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const el = t.closest<HTMLElement>("[data-hint]");
      if (!el) return;
      const target = readHintAttrs(el);
      if (!target) return;
      scheduleShow(el, target);
    }
    function onLeave(e: Event): void {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const el = t.closest<HTMLElement>("[data-hint]");
      if (!el) return;
      scheduleHide();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && stateRef.current) dismiss();
    }
    function onScrollOrResize(): void {
      const s = stateRef.current;
      if (s) setState(popoverFromTarget(s.target));
    }
    document.addEventListener("mouseover", onEnter);
    document.addEventListener("mouseout", onLeave);
    document.addEventListener("focusin", onEnter);
    document.addEventListener("focusout", onLeave);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      dismiss();
      document.removeEventListener("mouseover", onEnter);
      document.removeEventListener("mouseout", onLeave);
      document.removeEventListener("focusin", onEnter);
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  if (!state) return <>{children}</>;
  return (
    <>
      {children}
      {createPortal(
        <div
          className={`hint-bubble is-${state.placement}`}
          style={{ left: state.x, top: state.y }}
          role="tooltip"
        >
          <span className="hint-label">{state.target.label}</span>
          {state.target.el.dataset.hintCmd ? (
            <ShortcutNode cmdId={state.target.el.dataset.hintCmd} />
          ) : state.target.el.dataset.hintShortcut ? (
            <span className="hint-keys" aria-hidden>
              {state.target.el.dataset.hintShortcut}
            </span>
          ) : null}
        </div>,
        document.body,
      )}
    </>
  );
}
