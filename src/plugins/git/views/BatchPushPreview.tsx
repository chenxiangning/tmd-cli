/**
 * BatchPushPreview —— 多仓推送弹窗右栏:选中仓的本次推送内容。
 * 上 = 提交清单(sha + 摘要 + 作者 + 相对时间);下 = 选中提交的变更文件
 * (状态字母着色 + 路径 + +a/−d),头部给「n 个提交 / m 个文件」计数。
 * 数据复用单仓弹窗 hooks(usePushPreview 180ms 防抖 / useCommitDetails)。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { formatRelativeTime } from "@kernel/relativeTime";
import { useCommitDetails, usePushPreview } from "./remoteDialogs/usePushPreview";
import { STATUS_COLOR } from "./statusColor";

/** 提交清单区(选中高亮,头部计数)。 */
function CommitsPane({
  loading,
  error,
  commits,
  activeSha,
  onPick,
}: {
  loading: boolean;
  error: string | null;
  commits: readonly { longSha: string; shortSha: string; summary: string; authorName: string; authorWhen: number }[];
  activeSha: string | null;
  onPick: (sha: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-[3] flex-col rounded-md border border-(--tmd-border)">
      <div className="shrink-0 border-b border-(--tmd-border) px-2.5 py-1.5 text-xs text-(--tmd-fg-subtle)">
        {t("本次推送提交")}
        {commits.length > 0 && <span className="float-right tabular-nums">{commits.length}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex h-16 items-center justify-center gap-1.5 text-xs text-(--tmd-fg-faint)">
            <Spinner /> {t("加载中…")}
          </div>
        )}
        {!loading && error != null && (
          <div className="px-2.5 py-2 text-xs text-(--tmd-diff-removed)">{error}</div>
        )}
        {!loading && error == null && commits.length === 0 && (
          <div className="grid h-16 place-items-center text-xs text-(--tmd-fg-faint)">{t("已是最新")}</div>
        )}
        {commits.map((c) => (
          <button
            key={c.longSha}
            type="button"
            onClick={() => onPick(c.longSha)}
            className={`flex w-full items-baseline gap-2 px-2.5 py-1 text-left text-xs ${
              activeSha === c.longSha ? "bg-(--tmd-bg-active)" : "hover:bg-(--tmd-bg-hover)"
            }`}
          >
            <span className="shrink-0 font-mono text-(--tmd-fg-faint)">{c.shortSha}</span>
            <span className="min-w-0 flex-1 truncate">{c.summary}</span>
            <span className="shrink-0 text-[10.5px] text-(--tmd-fg-faint)">
              {c.authorName} · {formatRelativeTime(c.authorWhen * 1000)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 选中提交的变更文件区(状态字母着色 + +a/−d,头部计数)。 */
function FilesPane({
  activeSha,
  details,
  loading,
  error,
}: {
  activeSha: string | null;
  details: readonly { path: string; status: string; additions: number; deletions: number; binary: boolean }[] | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-[2] flex-col rounded-md border border-(--tmd-border)">
      <div className="shrink-0 border-b border-(--tmd-border) px-2.5 py-1.5 text-xs text-(--tmd-fg-subtle)">
        {t("选中提交详情")}
        {details != null && <span className="float-right tabular-nums">{t("{n} 个文件", { n: details.length })}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {activeSha == null && <div className="grid h-12 place-items-center text-xs text-(--tmd-fg-faint)">{t("请选择一条提交查看详情。")}</div>}
        {activeSha != null && loading && (
          <div className="flex h-12 items-center justify-center gap-1.5 text-xs text-(--tmd-fg-faint)">
            <Spinner /> {t("加载中…")}
          </div>
        )}
        {error != null && <div className="px-2.5 py-2 text-xs text-(--tmd-diff-removed)">{error}</div>}
        {details?.map((f) => (
          <div key={f.path} className="flex items-baseline gap-2 px-2.5 py-0.5 text-xs">
            <span className={`w-3 shrink-0 font-mono font-semibold ${STATUS_COLOR[f.status] ?? ""}`}>{f.status}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.path}</span>
            {!f.binary && (
              <span className="shrink-0 tabular-nums text-[10.5px]">
                <span className="text-(--tmd-diff-inserted)">+{f.additions}</span>{" "}
                <span className="text-(--tmd-diff-removed)">−{f.deletions}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BatchPushPreview({
  cwd,
  remote,
  target,
  ahead,
}: {
  cwd: string;
  remote: string;
  target: string;
  /** 行内 ↑n 承诺数;预览列表按它截齐(远端跟踪引用缺失时 Rust 回退全量历史,见
   *  remote_ops.push_preview 的 target_found=false 语义,聚合弹窗只展示本次要推的)。 */
  ahead: number;
}) {
  const { preview, previewLoading, previewError } = usePushPreview(cwd, remote, target);
  const commits = (preview?.commits ?? []).slice(0, Math.max(ahead, 1));
  const [sha, setSha] = useState<string | null>(null);
  /* 选中提交派生化:sha 失效(切仓/改目标后预览刷新)自动回退首条,免 effect 同步。 */
  const activeSha = sha != null && commits.some((c) => c.longSha === sha) ? sha : (commits[0]?.longSha ?? null);
  const { details, detailsLoading, detailsError } = useCommitDetails(cwd, activeSha);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <CommitsPane loading={previewLoading} error={previewError} commits={commits} activeSha={activeSha} onPick={setSha} />
      <FilesPane activeSha={activeSha} details={details} loading={detailsLoading} error={detailsError} />
    </div>
  );
}
