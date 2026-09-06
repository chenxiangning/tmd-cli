/**
 * Memory 控制台统计卡 —— 自 MemoryConsoleCards.tsx 拆出(文件规模铁则)。
 * 统计(总数 / 本周新增 / 分 harness 条数 + 上次整理时刻)与最近沉淀(最新 12 条)。
 */

import { CATEGORY_CN, type MemoryItem } from "../protocol";
import { consoleCardCls } from "./MemoryConsoleCards";

function categoryLabel(key: string): string {
  return (CATEGORY_CN as Record<string, string>)[key] ?? key;
}

/** ── 统计:总数 / 本周新增 / 分 harness 条数 + 上次整理时刻 ── */
export function StatsCard({
  counts,
  lastDream,
}: {
  counts: { total: number; week: number; byHarness: [string, number][] };
  lastDream: string | null;
}) {
  return (
    <div className={`mb-3 ${consoleCardCls}`}>
      <div className="mb-2 text-[11.5px] font-semibold">统计</div>
      <div className="mb-2 flex flex-wrap gap-6">
        <div>
          <div className="font-mono text-xl font-bold">{counts.total}</div>
          <div className="text-[10.5px] text-(--tmd-fg-faint)">记忆总数</div>
        </div>
        <div>
          <div className="font-mono text-xl font-bold">{counts.week}</div>
          <div className="text-[10.5px] text-(--tmd-fg-faint)">本周新增</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {counts.byHarness.map(([name, n]) => (
          <div key={name} className="flex items-center gap-2">
            <span className="w-9 flex-none truncate text-[10.5px] text-(--tmd-fg-muted)">{name}</span>
            <span className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-(--tmd-bg-input)">
              <i
                className="block h-full rounded-full bg-(--tmd-accent)"
                style={{ width: `${Math.max(6, Math.round((n / counts.total) * 100))}%` }}
              />
            </span>
            <span className="w-6 flex-none text-right font-mono text-[10.5px] text-(--tmd-fg-faint)">{n}</span>
          </div>
        ))}
      </div>
      {lastDream && <div className="mt-2 truncate text-[10.5px] text-(--tmd-fg-faint)">上次整理:{lastDream}</div>}
    </div>
  );
}

/** ── 最近沉淀:最新 12 条(日期 + 类目 + 内容摘要) ── */
export function RecentCard({ recent }: { recent: MemoryItem[] }) {
  return (
    <div className={consoleCardCls}>
      <div className="mb-2 text-[11.5px] font-semibold">最近沉淀</div>
      {recent.length === 0 ? (
        <div className="text-[11px] text-(--tmd-fg-faint)">无记录</div>
      ) : (
        recent.map((m) => (
          <div key={m.id} className="flex min-w-0 gap-2 border-b border-(--tmd-border) py-1 text-[11px] last:border-b-0">
            <span className="flex-none font-mono text-[10.5px] text-(--tmd-fg-faint)">
              {new Date(m.updatedAt).toLocaleDateString("zh-CN")}
            </span>
            <span className="flex-none text-[10.5px] text-(--tmd-fg-subtle)">
              {categoryLabel(m.category)}
            </span>
            <span className="min-w-0 flex-1 truncate text-(--tmd-fg-muted)">{m.content}</span>
          </div>
        ))
      )}
    </div>
  );
}
