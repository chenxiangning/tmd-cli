/**
 * HistoryView —— 历史视图:VS Code SCM Graph 风格泳道列表。
 *
 * 行结构 = 泳道 SVG 左列 + 内容:提交行(摘要 + ref 胶囊)/ 合成标记行
 * (传出的更改 / 传入的更改)/ 展开的文件行(图标 + 路径 + 状态字母)。
 * 点击提交行展开/收起文件清单(按需拉 git_commit_files);
 * 点击文件行在左侧文件开启容器(编辑器区)打开提交 diff tab。
 * 分页沿用:滚动近底自动 loadMore。
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { resolveFileVisual } from "@kernel/fileVisual";
import { formatAbsolute } from "@kernel/relativeTime";
import type { GitCommitFile, GitLogEntry } from "@kernel/ipc";
import type { GitLogState } from "../hooks/useGitLog";
import { useCommitFiles } from "../hooks/useCommitFiles";
import {
  computeGitGraph,
  type GraphRow,
} from "../graph/gitGraph";
import { GitGraphContinuationCell, GitGraphSvgCell } from "./GraphCells";
import { openCommitDiffTab } from "../commitTab";
import { STATUS_COLOR } from "./statusColor";
import { formatRelativeTime } from "@kernel/relativeTime";

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

type HistoryRow =
  | { type: "commit"; commit: GitLogEntry; graph: GraphRow }
  | { type: "file"; commit: GitLogEntry; file: GitCommitFile; graph: GraphRow }
  | { type: "marker"; kind: "incoming-changes" | "outgoing-changes"; graph: GraphRow };

const ROW_CLASS =
  "flex h-[22px] w-full min-w-0 select-none items-center gap-1 px-1.5 text-left text-xs";

export function HistoryView({ log, cwd, branch, upstream, ahead, behind }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const { entries: fileEntries, ensure } = useCommitFiles(cwd);

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
          {log.error ? log.error.replace(/^E_[A-Z_]+:\s*/, "") : "暂无提交历史"}
        </div>
      )}

      {rows.map((row) => {
        if (row.type === "marker") {
          const label = row.kind === "outgoing-changes" ? "传出的更改" : "传入的更改";
          return (
            <div
              key={`${row.kind}:${row.graph.sha}`}
              className={ROW_CLASS}
              title={upstream ? `${label} ${upstream}` : label}
            >
              <GitGraphSvgCell row={row.graph} />
              <span className="min-w-0 flex-1 truncate font-medium text-(--tmd-fg-muted)">
                {label}
              </span>
            </div>
          );
        }

        if (row.type === "file") {
          const name = row.file.path.split("/").pop() ?? row.file.path;
          const dir = row.file.path.includes("/")
            ? row.file.path.slice(0, row.file.path.lastIndexOf("/"))
            : "";
          const icon = resolveFileVisual(name, false);
          return (
            <button
              type="button"
              key={`file:${row.commit.longSha}:${row.file.status}:${row.file.oldPath ?? ""}:${row.file.path}`}
              className={`${ROW_CLASS} cursor-pointer hover:bg-(--tmd-bg-hover)`}
              title={row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path}
              onClick={() => openFile(row.commit, row.file)}
            >
              <GitGraphContinuationCell row={row.graph} />
              <span
                className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: icon.svgHtml }}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{name}</span>
                {dir && <span className="ml-1 text-[10px] text-(--tmd-fg-faint)">{dir}</span>}
              </span>
              <span
                className={`w-3 shrink-0 text-center font-semibold ${STATUS_COLOR[row.file.status] ?? ""}`}
              >
                {row.file.status}
              </span>
            </button>
          );
        }

        const sha = row.commit.longSha;
        const isExpanded = expanded.has(sha);
        const entry = fileEntries[sha];
        return (
          <Fragment key={`commit:${sha}`}>
            <button
              type="button"
              aria-expanded={isExpanded}
              title={`${row.commit.authorName} <${row.commit.authorEmail}>\n${formatAbsolute(
                row.commit.authorWhen * 1000,
              )} · ${row.commit.shortSha}`}
              onClick={() => toggleExpand(row.commit)}
              className={`${ROW_CLASS} cursor-pointer hover:bg-(--tmd-bg-hover) ${
                isExpanded ? "bg-(--tmd-bg-active)" : ""
              }`}
            >
              <GitGraphSvgCell row={row.graph} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.commit.summary || "(空消息)"}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-(--tmd-fg-faint)">
                {formatRelativeTime(row.commit.authorWhen * 1000)}
              </span>
            </button>
            {/* 展开区占位:清单加载中/失败给一行反馈,成功后由 rows 出文件行 */}
            {isExpanded && entry?.loading && (
              <div className={ROW_CLASS} title="加载改动文件">
                <GitGraphContinuationCell row={row.graph} />
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-(--tmd-fg-faint)" />
                <span className="text-(--tmd-fg-faint)">加载中…</span>
              </div>
            )}
            {isExpanded && entry?.error && (
              <div className={ROW_CLASS} title={entry.error}>
                <GitGraphContinuationCell row={row.graph} />
                <span className="truncate text-(--tmd-diff-removed)">
                  {entry.error.replace(/^E_[A-Z_]+:\s*/, "")}
                </span>
              </div>
            )}
            {/* 空提交:清单已载且为空,给一行明示而非无声收场 */}
            {isExpanded && entry && !entry.loading && !entry.error && entry.files.length === 0 && (
              <div className={ROW_CLASS}>
                <GitGraphContinuationCell row={row.graph} />
                <span className="text-(--tmd-fg-faint)">无改动文件</span>
              </div>
            )}
          </Fragment>
        );
      })}


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
