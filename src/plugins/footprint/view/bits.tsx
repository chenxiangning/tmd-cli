/**
 * footprint 视图层共享小组件:引擎色标、图标按钮、文本高亮。
 * 原型 docs/design/daily-work-footprint/v2-prototype.html 的视觉语义,
 * Tailwind 4 + 内联 svg,不引新依赖。
 */
import type { ReactNode } from "react";
import { engineColor } from "./engineColor";

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
      className="rounded p-0.5 leading-none text-[var(--tmd-fg-3,#94a3b8)] opacity-40 transition-colors hover:bg-[var(--tmd-surface-3,#e2e8f0)] hover:text-[var(--tmd-accent,#2563eb)] hover:opacity-100"
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
      <mark className="bg-transparent font-bold text-[var(--tmd-accent,#2563eb)]">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
