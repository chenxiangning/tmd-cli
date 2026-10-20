/**
 * footprint 视图层共享小组件:引擎色标、图标按钮、文本高亮。
 * 原型 docs/design/daily-work-footprint/v2-prototype.html 的视觉语义,
 * Tailwind 4 + 内联 svg,不引新依赖。
 */
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { engineColor } from "./engineColor";

/** 容器首测出非零宽度前返回 false(测量型布局组件的挂载闸:Group 在 0 宽
 * 容器里首测会把 defaultSize 折算成退化 fr 布局并随宽度等比放大)。 */
export function useMeasuredWidth(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      if (entries.some((en) => en.contentRect.width > 0)) setMeasured(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, measured];
}

/** 引擎小色标(白字 + 品牌色底)。 */
export function EngTag({ engine }: { engine: string }) {
  return (
    <span
      className="flex-none rounded px-1.5 py-0 text-[10px] font-semibold text-white"
      style={{ background: engineColor(engine) }}
    >
      {engine}
    </span>
  );
}

/** 打开文件(外链箭头)图标。 */
export function IcoOpen({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/** 会话(气泡)图标,功能卡 meta 用。 */
export function IcoChat({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 1 1-4-6.9" />
      <path d="M8 11h8M8 15h5" />
    </svg>
  );
}

/** 文件列表图标,功能卡 meta 用。 */
export function IcoFiles({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

/** 所在文件夹图标。 */
export function IcoFolder({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 图标动作钮(打开文件/所在文件夹;常显低透明,hover 提亮)。 */
export function FicoButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      className="rounded p-0.5 leading-none text-[var(--tmd-fg-muted)] transition-colors hover:bg-[var(--tmd-bg-elevated)] hover:text-[var(--tmd-accent,var(--tmd-accent))]"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** 关键词高亮(大小写不敏感的首处命中;无命中原样返回)。 */
export function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-[var(--tmd-accent,var(--tmd-accent))]">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
