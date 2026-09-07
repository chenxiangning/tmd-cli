/**
 * PushDialog 预览双栏 —— 自 PushDialog.tsx 拆出(文件规模铁则)。
 * 左栏 = 本次推送提交清单(新分支首推送说明态);右栏 = 选中提交详情
 * (摘要行 + 变更文件树,点击开中央提交 diff tab)。PreviewPane 为双栏共用外壳。
 */

import { t } from "@kernel/i18n";
import { FileText, GitBranch, GitCommit } from "@phosphor-icons/react";
import type { GitCommitFile, GitPushPreview } from "@kernel/ipc";
import { formatRelativeTime } from "@kernel/relativeTime";
import { CommitFileTree } from "./CommitFileTree";
import { PREVIEW_LIMIT } from "./usePushPreview";

type PreviewCommit = GitPushPreview["commits"][number];

export function PushPreviewColumns({
  cwd,
  branch,
  remote,
  target,
  preview,
  previewLoading,
  previewError,
  selectedSha,
  onSelectSha,
  details,
  detailsLoading,
  detailsError,
  onFileSelect,
}: {
  cwd: string;
  branch: string;
  remote: string;
  target: string;
  preview: GitPushPreview | null;
  previewLoading: boolean;
  previewError: string | null;
  selectedSha: string | null;
  onSelectSha: (sha: string) => void;
  details: GitCommitFile[] | null;
  detailsLoading: boolean;
  detailsError: string | null;
  onFileSelect: (f: GitCommitFile, commit: PreviewCommit | null) => void;
}) {
  const commits = preview?.commits ?? [];
  const selected = commits.find((c) => c.longSha === selectedSha) ?? null;
  const isNewTarget = preview != null && !preview.targetFound;

  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <PreviewPane
        title={t("本次推送提交")}
        count={commits.length}
        loading={previewLoading}
        error={previewError}
        hasMore={preview?.hasMore ?? false}
      >
        {isNewTarget && !previewLoading && !previewError ? (
          <div className="px-1 py-2 text-xs leading-5 text-(--tmd-fg-muted)">
            <div className="font-medium text-(--tmd-fg)">{t("新分支首次推送")}</div>
            <div className="mt-1">
              {t(
                "本地未找到目标引用 {ref},将按新分支首次推送处理:创建远端分支并推送当前分支提交。",
                { ref: `${remote.trim() || "origin"}/${target.trim() || branch}` },
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
            {commits.map((c) => (
              <button
                key={c.longSha}
                type="button"
                onClick={() => onSelectSha(c.longSha)}
                className={`rounded px-1.5 py-1 text-left text-xs ${
                  selectedSha === c.longSha
                    ? "bg-(--tmd-accent-soft)"
                    : "hover:bg-(--tmd-bg-hover)"
                }`}
              >
                <div className="truncate font-medium text-(--tmd-fg)">
                  {c.summary || t("(无提交信息)")}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-(--tmd-fg-muted)">
                  <code className="font-mono">{c.shortSha}</code>
                  <em className="not-italic">{c.authorName || t("未知")}</em>
                  <time>{formatRelativeTime(c.authorWhen * 1000)}</time>
                </div>
              </button>
            ))}
            {preview?.hasMore && (
              <div className="px-1.5 py-1 text-[11px] text-(--tmd-fg-faint)">
                {t("仅展示最近 {n} 条提交。", { n: PREVIEW_LIMIT })}
              </div>
            )}
          </div>
        )}
      </PreviewPane>

      <PreviewPane
        title={t("选中提交详情")}
        count={details?.length ?? 0}
        loading={detailsLoading}
        error={detailsError}
        hasMore={false}
      >
        {!selectedSha ? (
          <div className="px-1 py-2 text-xs text-(--tmd-fg-faint)">{t("请选择一条提交查看详情。")}</div>
        ) : (
          details && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="px-1 text-xs leading-5 text-(--tmd-fg-muted)">
                <div className="truncate font-medium text-(--tmd-fg)">
                  {selected?.summary || t("(无提交信息)")}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  <code className="font-mono">{selected?.longSha.slice(0, 16) ?? selectedSha.slice(0, 16)}…</code>
                  <em className="not-italic">{selected?.authorName || t("未知")}</em>
                  <time>
                    {new Date((selected?.authorWhen ?? 0) * 1000).toLocaleString()}
                  </time>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1 px-1 text-xs font-medium text-(--tmd-fg)">
                <GitBranch className="h-3.5 w-3.5" aria-hidden />
                {t("变更文件")}
                <i className="ml-auto not-italic text-(--tmd-fg-muted)">{details.length}</i>
              </div>
              <div className="mt-1 min-h-0 flex-1 overflow-auto rounded border border-(--tmd-border) p-1">
                <CommitFileTree
                  rootName={cwd.split("/").filter(Boolean).pop() ?? ""}
                  files={details}
                  selectedPath={null}
                  onSelect={(f) => onFileSelect(f, selected)}
                />
              </div>
            </div>
          )
        )}
      </PreviewPane>
    </div>
  );
}

function PreviewPane({
  title,
  count,
  loading,
  error,
  hasMore,
  children,
}: {
  title: string;
  count: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-64 min-h-0 flex-col rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2">
      <div className="flex shrink-0 items-center gap-1 px-1 text-xs font-medium text-(--tmd-fg)">
        {title === t("本次推送提交") ? (
          <GitCommit className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden />
        )}
        {title}
        <strong className="ml-auto font-semibold text-(--tmd-fg-muted)">
          {title === t("本次推送提交") && hasMore ? `${count}+` : count}
        </strong>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="px-1 py-2 text-xs text-(--tmd-fg-faint)">
            {title === t("本次推送提交") ? t("正在加载推送预览提交...") : t("正在加载提交详情...")}
          </div>
        ) : error ? (
          <div className="px-1 py-2 text-xs leading-5 text-(--tmd-diff-removed)">{error}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
