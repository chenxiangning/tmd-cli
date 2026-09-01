/**
 * 触发器候选下拉 —— 浮在 textarea 上方。
 */

import type { SuggestionMatch } from "../triggers/suggest";

export interface SuggestionListProps {
  matches: SuggestionMatch[];
  pickIndex: number;
  onPick(match: SuggestionMatch): void;
  onHoverIndex(i: number): void;
}

export function SuggestionList({ matches, pickIndex, onPick, onHoverIndex }: SuggestionListProps) {
  if (matches.length === 0) return null;
  return (
    <div className="absolute left-0 right-0 top-7 z-10 max-h-56 overflow-auto rounded border border-(--tmd-border-strong) bg-(--tmd-bg-popover) shadow-lg backdrop-blur">
      {matches.map((m, i) => {
        const active = i === pickIndex;
        return (
          <button
            key={`${m.value}-${i}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(m);
            }}
            onMouseEnter={() => onHoverIndex(i)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
              active ? "bg-(--tmd-bg-hover) text-(--tmd-fg)" : "text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
            }`}
          >
            <span className="font-mono">{m.value}</span>
            {m.description && (
              <span className="truncate text-(--tmd-fg-subtle)">{m.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
