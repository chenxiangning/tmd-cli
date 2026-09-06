/**
 * BranchCompareModal —— 分支对比 / 工作树差异弹窗(codemoss BranchDiffSection 同构复刻)。
 *
 * compare 模式:头部「分支对比」徽标 + 标题「分支 X 与 Y 差异」+ 副标题(比较基线/
 * 目标分支)+「独有提交 N 个」统计;左列上下两个可折叠分区(targetOnly / currentOnly,
 * 集合差标注 +「N 个提交」胶囊 + 空态「该方向无独有提交。」),提交卡选中态高亮,
 * 自动选中第一个独有提交;右列 CommitDetailsPanel(摘要/message/文件列表/单文件 patch)。
 * worktree 模式:WorktreeDiffPanel(左 diff + 右文件列表)。
 * 列表数据低频按需拉,token 防 request 切换竞态;portal + z-1000,Esc/遮罩关闭。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, GitDiff, CircleNotch, Cross } from "@phosphor-icons/react";
import { ipc, type GitBranchCompareSet, type GitBranchDiffFile, type GitLogEntry } from "@kernel/ipc";
import { formatRelativeTime } from "@kernel/relativeTime";
import { gitErrorDisplay } from "../gitError";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import { WorktreeDiffPanel } from "./WorktreeDiffPanel";

export type BranchCompareRequest =
  | { mode: "compare"; target: string }
  | { mode: "worktree"; branch: string };

export function BranchCompareModal({
  cwd,
  currentName,
  request,
  onClose,
}: {
  cwd: string;
  currentName: string | undefined;
  request: BranchCompareRequest;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<GitBranchCompareSet | null>(null);
  const [files, setFiles] = useState<GitBranchDiffFile[] | null>(null);
  const [selected, setSelected] = useState<GitLogEntry | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    setLoading(true);
    setError(null);
    setSelected(null);
    const req =
      request.mode === "compare"
        ? ipc
            .gitBranchCompare(cwd, request.target, currentName ?? "")
            .then((data: GitBranchCompareSet) => {
              if (token !== tokenRef.current) return;
              setCompare(data);
              setLoading(false);
            })
        : ipc.gitBranchWorktreeFiles(cwd, request.branch).then((data: GitBranchDiffFile[]) => {
            if (token !== tokenRef.current) return;
            setFiles(data);
            setLoading(false);
          });
    req.catch((e: unknown) => {
      if (token !== tokenRef.current) return;
      setError(gitErrorDisplay(e));
      setLoading(false);
    });
  }, [cwd, request, currentName]);

  /* 数据到位后自动选中第一个独有提交(已选且仍存在则保持) */
  useEffect(() => {
    if (request.mode !== "compare" || !compare) return;
    const inList = (list: GitLogEntry[]) => list.some((c) => c.longSha === selected?.longSha);
    if (selected && (inList(compare.targetOnly) || inList(compare.currentOnly))) return;
    setSelected(compare.targetOnly[0] ?? compare.currentOnly[0] ?? null);
  }, [compare, request.mode, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const badge =
    request.mode === "compare" ? "分支对比" : "工作树差异";
  const title =
    request.mode === "compare"
      ? `分支 ${request.target} 与 ${currentName ?? "?"} 差异`
      : `工作树 与 ${request.branch} 差异`;
  const subtitle =
    request.mode === "compare"
      ? `比较基线: ${request.target}, 目标分支: ${currentName ?? "?"}`
      : `基准分支: ${request.branch}`;
  const uniqueTotal =
    request.mode === "compare"
      ? (compare?.targetOnly.length ?? 0) + (compare?.currentOnly.length ?? 0)
      : null;

  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex h-[min(760px,86vh)] w-[min(1120px,94vw)] flex-col overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-popover) shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部:徽标 + 标题 + 关闭;副标题 + 统计 */}
        <div className="shrink-0 border-b border-(--tmd-border) px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded bg-(--tmd-accent-soft) px-1.5 py-0.5 text-[10px] font-medium text-(--tmd-accent)">
              <GitDiff className="h-3 w-3" />
              {badge}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--tmd-fg)">
              {title}
            </span>
            <button
              onClick={onClose}
              title="关闭"
              className="rounded p-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
            >
              <Cross className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-3 py-1.5">
            <span className="text-xs text-(--tmd-fg-muted)">{subtitle}</span>
            {uniqueTotal != null && (
              <span className="text-xs text-(--tmd-fg-faint)">
                独有提交 <span className="font-medium text-(--tmd-fg)">{uniqueTotal}</span> 个
              </span>
            )}
          </div>
        </div>

        {/* 主体 */}
        {loading && (
          <div className="flex flex-1 items-center justify-center gap-1.5 text-(--tmd-fg-faint)">
            <CircleNotch className="h-3.5 w-3.5 animate-spin" /> 加载中…
          </div>
        )}
        {error && (
          <div className="m-3 rounded bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
            {error}
          </div>
        )}
        {!loading && !error && request.mode === "compare" && compare && (
          <div className="flex min-h-0 flex-1">
            <div className="flex w-[44%] min-w-[320px] flex-col gap-2 overflow-y-auto border-r border-(--tmd-border) p-2">
              <UniqueSection
                branch={request.target}
                other={currentName ?? "?"}
                label={`${request.target} 独有`}
                commits={compare.targetOnly}
                selectedSha={selected?.longSha ?? null}
                onSelect={setSelected}
              />
              <UniqueSection
                branch={currentName ?? "?"}
                other={request.target}
                label={`${currentName ?? "?"} 独有`}
                commits={compare.currentOnly}
                selectedSha={selected?.longSha ?? null}
                onSelect={setSelected}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
              {selected ? (
                <CommitDetailsPanel cwd={cwd} commit={selected} />
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-(--tmd-fg-faint)">
                  选择提交查看详情
                </div>
              )}
            </div>
          </div>
        )}
        {!loading && !error && request.mode === "worktree" && (
          <WorktreeDiffPanel
            cwd={cwd}
            branch={request.branch}
            files={files ?? []}
            loading={loading}
            error={null}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 单方向独有提交分区:可折叠头(圆点 + 集合差标注 + 计数胶囊)+ 提交卡列表。 */
function UniqueSection({
  branch,
  other,
  label,
  commits,
  selectedSha,
  onSelect,
}: {
  branch: string;
  other: string;
  label: string;
  commits: GitLogEntry[];
  selectedSha: string | null;
  onSelect: (c: GitLogEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded border border-(--tmd-border)">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left"
        title={open ? "收起" : "展开"}
      >
        <CaretDown
          className={`h-3 w-3 shrink-0 text-(--tmd-fg-faint) transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--tmd-accent)" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--tmd-fg)">
          {label}
          <span className="font-normal text-(--tmd-fg-faint)">({branch} \ {other})</span>
        </span>
        <span className="shrink-0 rounded-full bg-(--tmd-accent-soft) px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">
          {commits.length} 个提交
        </span>
      </button>
      {open && (
        <div className="border-t border-(--tmd-border) p-1">
          {commits.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-(--tmd-fg-faint)">
              该方向无独有提交。
            </div>
          )}
          {commits.map((c) => {
            const active = c.longSha === selectedSha;
            return (
              <button
                key={c.longSha}
                onClick={() => onSelect(c)}
                className={`mb-1 block w-full rounded border px-2 py-1.5 text-left ${
                  active
                    ? "border-(--tmd-accent) bg-(--tmd-accent-soft)"
                    : "border-transparent hover:bg-(--tmd-bg-hover)"
                }`}
              >
                <div className="truncate text-xs font-medium text-(--tmd-fg)">
                  {c.summary || "(空消息)"}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-(--tmd-fg-faint)">
                  <span className="font-mono">{c.shortSha}</span>
                  <span>{c.authorName}</span>
                  <span>{formatRelativeTime(c.authorWhen * 1000)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
