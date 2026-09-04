/**
 * 触发器候选面板 —— 统一悬在对话框(composer 输入框)上方,不再遮挡书写区。
 *
 * 几何契约:portal 挂 body + fixed 定位(Panel 容器 overflow:hidden 会裁切
 * absolute 子元素),锚定坐标由 Composer 量测传入 —— 底缘 = 对话框顶缘 - 8px,
 * 左右各留 12px,向上生长、maxHeight 封顶后内部滚动。
 * 动效:translateY(-12px) → 0,朝输入线方向落下归位。
 *
 * 焦点契约:容器级 onMouseDown preventDefault —— 点面板任何位置(含空白)都不抢
 * textarea 焦点,方向键选中和直接打字过滤因此始终有效;点击面板外则由 Composer
 * 的 onBlur 关闭面板。
 *
 * 结构(对照 codex 命令面板):
 * - 分区标题(命令 / 技能 / 文件,按当前触发符)
 * - 条目:触发符 + 命令名(semibold)+ 描述;选中项整行 accent 圆角高亮
 * - 列表可滚动且未到底时,底缘渐隐(锚定在面板自身)
 */

import { useEffect, useRef, useState } from "react";
import type { SuggestionMatch } from "../triggers/suggest";

const KIND_META: Record<string, { label: string; char: string }> = {
  command: { label: "命令", char: "/" },
  skill: { label: "技能", char: "$" },
  file: { label: "文件", char: "" },
};

interface SuggestionListProps {
  matches: SuggestionMatch[];
  pickIndex: number;
  onPick(match: SuggestionMatch): void;
  onHoverIndex(i: number): void;
  /** fixed 锚定几何( left/width/bottom/maxHeight ),Composer 量测传入。 */
  style?: React.CSSProperties;
}

export function SuggestionList({ matches, pickIndex, onPick, onHoverIndex, style }: SuggestionListProps) {
  const [shown, setShown] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* 挂载后下一帧翻开,触发向上滑入过渡 */
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  /* 候选变化后重算"是否可滚动"(渐隐只在此为真时出现) */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setScrollable(el.scrollHeight > el.clientHeight + 1);
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  }, [matches]);

  /* 键盘选中项滚入可视区 */
  useEffect(() => {
    itemRefs.current[pickIndex]?.scrollIntoView({ block: "nearest" });
  }, [pickIndex, matches]);

  if (matches.length === 0) return null;
  const kind = matches[0]?.kind ?? "command";
  const meta = KIND_META[kind] ?? KIND_META.command;

  function syncScrollState() {
    const el = listRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  }

  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className={`fixed z-50 flex flex-col overflow-hidden rounded-xl
        border border-(--tmd-border) bg-(--tmd-bg-popover) shadow-[0_16px_40px_rgba(0,0,0,0.4)]
        transition-all duration-200 ease-out motion-reduce:transition-none
        ${shown ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"}`}
      style={style}
    >
      {/* 分区标题 */}
      <div className="shrink-0 px-3.5 pt-2 pb-1 text-[11px] tracking-widest text-(--tmd-fg-faint)">
        {meta.label}
      </div>

      {/* 条目列表(渐隐锚定面板自身,仅在可滚动且未到底时出现) */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={syncScrollState}
          className="h-full overflow-y-auto px-1 pb-1.5"
        >
          {matches.map((m, i) => {
            const active = i === pickIndex;
            return (
              <button
                key={`${m.value}-${i}`}
                ref={(el) => { itemRefs.current[i] = el; }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(m);
                }}
                onMouseEnter={() => onHoverIndex(i)}
                aria-selected={active}
                className={`flex w-full items-baseline gap-3 rounded-lg px-2.5 py-1.5 text-left ${
                  active ? "bg-(--tmd-bg-active)" : "hover:bg-(--tmd-bg-hover)/60"
                }`}
              >
                <span className={`shrink-0 font-mono text-sm font-semibold ${active ? "text-(--tmd-accent)" : "text-(--tmd-fg)"}`}>
                  {meta.char}
                  {m.value}
                </span>
                {m.description && (
                  <span className="truncate text-[13px] text-(--tmd-fg-subtle)">{m.description}</span>
                )}
              </button>
            );
          })}
        </div>
        {scrollable && !atBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-b from-transparent to-(--tmd-bg-popover)" />
        )}
      </div>
    </div>
  );
}
