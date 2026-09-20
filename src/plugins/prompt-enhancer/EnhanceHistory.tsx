/**
 * 历史面板 —— 最近增强记录(新→旧):点击回填原文/终稿与引擎/档位/模型后回双栏。
 * 只读列表;清空与否随容量 LRU,不做管理操作(非关键数据,YAGNI)。
 */

import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { getHistory, type EnhanceHistoryEntry } from "./enhanceStore";

function timeLabel(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function EnhanceHistory({ onPick }: { onPick: (e: EnhanceHistoryEntry) => void }) {
  const [entries, setEntries] = useState<EnhanceHistoryEntry[] | null>(null);
  useEffect(() => setEntries([...getHistory()]), []);
  if (!entries) return null;
  if (entries.length === 0) {
    return <div className="mt-3 h-64 rounded border border-(--tmd-border) p-4 text-xs text-(--tmd-fg-muted)">{t("暂无历史记录")}</div>;
  }
  return (
    <div className="mt-3 flex h-64 flex-col overflow-y-auto rounded border border-(--tmd-border)">
      {entries.map((e) => (
        <button
          key={`${e.at}-${e.engineId}-${e.original}`}
          type="button"
          onClick={() => onPick(e)}
          className="flex flex-col gap-0.5 border-b border-(--tmd-border) px-3 py-2 text-left text-xs last:border-b-0 hover:bg-(--tmd-bg-hover)"
        >
          <span className="flex items-center gap-2 text-(--tmd-fg-muted)">
            <span className="font-mono">{e.engineId}</span>
            <span>{e.model || t("默认")}</span>
            <span className="ml-auto">{timeLabel(e.at)}</span>
          </span>
          <span className="truncate text-(--tmd-fg)">{e.enhanced.split("\n")[0]}</span>
        </button>
      ))}
    </div>
  );
}
