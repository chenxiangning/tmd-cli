/**
 * HistoryView —— 历史视图:VS Code SCM Graph 风格泳道列表。
 *
 * 数据装配(泳道图 → 行数组)+ 窗口化滚动容器;行渲染拆至 HistoryRow.tsx。
 * 点击提交行展开/收起文件清单(按需拉 git_commit_files);
 * 点击文件行在左侧文件开启容器(编辑器区)打开提交 diff tab。
 * 分页沿用:滚动近底自动 loadMore。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import type { GitCommitFile, GitLogEntry } from "@kernel/ipc";
import type { GitLogState } from "../hooks/useGitLog";
import { useCommitFiles } from "../hooks/useCommitFiles";
import { computeGitGraph } from "../graph/gitGraph";
import { openCommitDiffTab } from "../commitTab";
import {
  HistoryRowItem,
  type HistoryRow,
} from "./HistoryRow";

interface Props {
  log: GitLogState;
  cwd: string;
  /** 当前分支名(status.branch;detached 形如 detached@xxxx) */
  branch: string;
  /** 上游分支名(如 origin/main);无上游 null */
  upstream: string | null;
  ahead: number;
  behind: number;
}

/* 行高确定性:提交行双行 40px,其余(marker/file/反馈行)22px —— 窗口化免测量。 */

/** 首个前缀和 >= y 的下界(二分)。 */
function lowerBound(offsets: readonly number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function HistoryView({ log, cwd, branch, upstream, ahead, behind }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const { entries: fileEntries, ensure } = useCommitFiles(cwd);
  /* 窗口化渲染:已加载页可累积数千行,全量常驻渲染卡顿 —— 只画视口 ±400px,
     行高确定性(commit 40 / 其余 22)免测量;近底自动翻页合并同一滚动监听。 */
  const [win, setWin] = useState({ top: 0, h: 600 });
  const rafRef = useRef(0);
  const loadMoreRef = useRef(log.loadMore);
  useEffect(() => {
    loadMoreRef.current = log.loadMore;
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const apply = () => {
      setWin({ top: el.scrollTop, h: el.clientHeight });
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) loadMoreRef.current();
    };
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        apply();
      });
    };
    apply();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setWin((p) => (p.h === el.clientHeight ? p : { ...p, h: el.clientHeight })),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const graphCommits = useMemo(
    () =>
      log.entries.map((e) => ({
        sha: e.longSha,
        parents: e.parentShas,
        refs: e.refs,
      })),
    [log.entries],
  );

  const gitGraph = useMemo(
    () =>
      computeGitGraph(graphCommits, {
        // detached 分支名不会命中任何 ref 装饰 → 算法退化为首行视为 head
        currentRef: branch.startsWith("detached@") ? "" : branch,
        remoteRef: upstream ?? "",
        remoteName: upstream?.split("/")[0],
        showRemoteChangeMarkers: Boolean(upstream),
        ahead,
        behind,
      }),
    [graphCommits, branch, upstream, ahead, behind],
  );

  const bySha = useMemo(() => new Map(log.entries.map((e) => [e.longSha, e])), [log.entries]);

  const rows = useMemo<HistoryRow[]>(() => {
    const out: HistoryRow[] = [];
    for (const graph of gitGraph.rows) {
      if (graph.kind !== "commit") {
        out.push({ type: "marker", kind: graph.kind, graph });
        continue;
      }
      const commit = bySha.get(graph.sha);
      if (!commit) continue;
      out.push({ type: "commit", commit, graph });
      if (!expanded.has(commit.longSha)) continue;
      const entry = fileEntries[commit.longSha];
      if (entry?.loading || entry?.error) continue; // 占位行单独渲染
      for (const file of entry?.files ?? []) {
        out.push({ type: "file", commit, file, graph });
      }
    }
    return out;
  }, [bySha, expanded, fileEntries, gitGraph.rows]);

  /* 前缀和行高 + 视口切片(±400px 冗余);线性界的 ±1 缓冲防半行裁切。 */
  const offsets = useMemo(() => {
    const arr = new Array<number>(rows.length + 1);
    arr[0] = 0;
    for (let i = 0; i < rows.length; i++) arr[i + 1] = arr[i] + (rows[i].type === "commit" ? 40 : 22);
    return arr;
  }, [rows]);
  const from = Math.max(0, lowerBound(offsets, win.top - 400) - 1);
  const to = Math.min(rows.length, lowerBound(offsets, win.top + win.h + 400) + 1);
  const visibleRows = rows.slice(from, to);

  const toggleExpand = (commit: GitLogEntry) => {
    const sha = commit.longSha;
    if (expanded.has(sha)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(sha);
        return next;
      });
    } else {
      ensure(sha); // 幂等:已拉取/在途不重发
      setExpanded((prev) => new Set(prev).add(sha));
    }
  };

  const openFile = (commit: GitLogEntry, file: GitCommitFile) => {
    openCommitDiffTab({
      cwd,
      sha: commit.longSha,
      shortSha: commit.shortSha,
      summary: commit.summary,
      authorName: commit.authorName,
      authorWhen: commit.authorWhen,
      focusPath: file.path,
    });
  };

  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto p-1">
      {log.entries.length === 0 && !log.loading && (
        <div className="flex h-24 items-center justify-center text-(--tmd-fg-faint)">
          {log.error ? log.error.replace(/^E_[A-Z_]+:\s*/, "") : t("暂无提交历史")}
        </div>
      )}

      <div style={{ height: offsets[from] }} aria-hidden />
      {visibleRows.map((row) => (
        <HistoryRowItem
          key={
            row.type === "file"
              ? `file:${row.commit.longSha}:${row.file.status}:${row.file.oldPath ?? ""}:${row.file.path}`
              : row.type === "commit"
                ? `commit:${row.commit.longSha}`
                : `${row.kind}:${row.graph.sha}`
          }
          row={row}
          upstream={upstream}
          expanded={row.type === "commit" ? expanded.has(row.commit.longSha) : undefined}
          entry={row.type === "commit" ? fileEntries[row.commit.longSha] : undefined}
          onToggle={toggleExpand}
          onOpenFile={openFile}
        />
      ))}
      <div style={{ height: offsets[rows.length] - offsets[to] }} aria-hidden />

      {log.loading && (
        <div className="flex items-center justify-center gap-1.5 py-2 text-(--tmd-fg-faint)">
          <CircleNotch className="h-[0.75rem] w-[0.75rem] animate-spin" /> {t("加载中…")}
        </div>
      )}
      {!log.hasMore && log.entries.length > 0 && (
        <div className="py-2 text-center text-[0.625rem] text-(--tmd-fg-faint)">{t("已到最早提交")}</div>
      )}
    </div>
  );
}
