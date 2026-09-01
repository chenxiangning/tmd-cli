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
    <div className="absolute left-3 right-3 top-2 z-10 max-h-56 overflow-auto rounded border border-neutral-700 bg-neutral-900/95 shadow-lg backdrop-blur">
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
              active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            <span className="font-mono">{m.value}</span>
            {m.description && (
              <span className="truncate text-neutral-500">{m.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
