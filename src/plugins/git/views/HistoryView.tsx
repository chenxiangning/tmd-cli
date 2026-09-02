/**
 * HistoryView —— 历史视图:log 摘要列表 + 分页 + commit patch 抽屉(复用 useGitDiffs 的 select 不适用,
 * commit diff 与 worktree diff 是两个数据源 —— MVP 只展示摘要,commit patch 留 proposal-2/Graph 联动)。
 */

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { GitLogState } from "../hooks/useGitLog";

export function HistoryView({ log }: { log: GitLogState }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 滚动近底自动翻页
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) log.loadMore();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [log.loadMore]);

  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto p-1">
      {log.entries.length === 0 && !log.loading && (
        <div className="flex h-24 items-center justify-center text-(--tmd-fg-faint)">
          {log.error ? log.error.replace(/^E_[A-Z_]+:\s*/, "") : "暂无提交历史"}
        </div>
      )}
      {log.entries.map((e) => (
        <div
          key={e.longSha}
          className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-(--tmd-bg-hover)"
          title={`${e.authorName} <${e.authorEmail}>\n${new Date(e.authorWhen * 1000).toLocaleString()}`}
        >
          <span className="shrink-0 font-mono text-[10px] text-(--tmd-accent)">{e.shortSha}</span>
          <span className="min-w-0 flex-1 truncate">{e.summary || "(空消息)"}</span>
          <span className="shrink-0 text-[10px] text-(--tmd-fg-faint)">
            {relativeDay(e.authorWhen)}
          </span>
        </div>
      ))}
      {log.loading && (
        <div className="flex items-center justify-center gap-1.5 py-2 text-(--tmd-fg-faint)">
          <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
        </div>
      )}
      {!log.hasMore && log.entries.length > 0 && (
        <div className="py-2 text-center text-[10px] text-(--tmd-fg-faint)">已到最早提交</div>
      )}
    </div>
  );
}

/** 粒度到天;更细的相对时间留 kernel/relativeTime(现有工具)后续接。 */
function relativeDay(unixSec: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSec) / 86400);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}
