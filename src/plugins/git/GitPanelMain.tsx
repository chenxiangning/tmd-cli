/**
 * GitPanel 主渲染 —— 自 GitPanel.tsx 拆出(no-high-complexity 降分支 +
 * 文件规模铁则):仓切换条/远端条/横幅簇/三视图/远端对话框的编排渲染;
 * 数据与派生展示值由 useGitPanelData 备好,此处零派生分支。
 */

import { useEffect } from "react";
import { t } from "@kernel/i18n";
import type { GitAheadBehind, GitFileStatus, GitRemoteRequest, GitRepoSummary, GitTotals } from "@kernel/ipc";
import { Cross } from "@phosphor-icons/react";
import { Spinner } from "@kernel/Spinner";
import type { GitLogState } from "./hooks/useGitLog";
import type { GitBranchesState } from "./hooks/useGitBranches";
import type { GitRepoContext } from "./repoContext";
import {
  requestWorktreeDialog,
  setGitRemoteMeta,
  type FileListLayout,
  type GitViewMode,
  type RemoteDialogOp,
} from "./panelStore";
import { GitToolbar } from "./GitToolbar";
import { gitErrorDisplay } from "./gitError";
import { SmartSwitchUndoBanner } from "./views/GitPanelBars";
import { RepoBar } from "./views/RepoBar";
import { RemoteDialogGroup } from "./views/RemoteDialogGroup";
import { DiffView } from "./views/DiffView";
import { BranchView } from "./views/BranchView";
import { HistoryView } from "./views/HistoryView";
import { WorktreeZone } from "./worktree/WorktreeZone";

/** GitPanel 远端编排面 —— useGitPanelRemote 返回值的结构契约(此处只消费渲染所需)。 */
interface GitPanelRemoteState {
  dialog: RemoteDialogOp | null;
  setDialog: (op: RemoteDialogOp | null) => void;
  remoteBusy: "push" | "pull" | "fetch" | null;
  pushOutcome: { ok: boolean; text: string } | null;
  notice: string | null;
  setNotice: (msg: string | null) => void;
  runDialog: (op: GitRemoteRequest["op"], req: GitRemoteRequest, opLabel: string) => void;
}

interface GitPanelMainProps {
  cwd: string;
  repoCtx: GitRepoContext;
  repos: GitRepoSummary[];
  truncated: boolean;
  chipSeq: number;
  onSelect: (path: string) => void;
  /** 聚合范围(本仓/全部)与段控可见性(spec 2026-10-08-git-batch-ops-design)。 */
  scope: "repo" | "all";
  showScope: boolean;
  onScope: (scope: "repo" | "all") => void;
  view: GitViewMode;
  layout: FileListLayout;
  files: GitFileStatus[];
  totals: GitTotals | null;
  branches: GitBranchesState;
  log: GitLogState;
  statusError: string | null;
  branch: string | undefined;
  branchName: string;
  upstreamNull: string | null;
  detached: boolean;
  unborn: boolean;
  hasUpstream: boolean;
  aheadBehind: GitAheadBehind | null;
  undoOrigin: { cwd: string; branch: string } | null;
  prefill: { message: string; seq: number } | null;
  afterMutation: () => void;
  remote: GitPanelRemoteState;
}

/** 智能切换撤销资格:当前仓存在冲突文件且来源仓匹配(no-high-complexity 降分支)。 */
function canUndoSmartSwitch(
  files: readonly GitFileStatus[],
  undoOrigin: { cwd: string; branch: string } | null,
  cwd: string,
): boolean {
  return files.some((f) => f.status === "C") && undoOrigin != null && undoOrigin.cwd === cwd;
}

/** 多仓时的展示仓名:取 cwd 末段(双分隔符;Windows 反斜杠安全);单仓 undefined(对话框按需自解析)。 */
function repoDisplayName(repoCount: number, cwd: string): string | undefined {
  return repoCount >= 2 ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? undefined) : undefined;
}

/** 面板横幅簇:通知(可关闭)/ 状态错误 / 智能切换撤销横幅(降分支拆件)。 */
function PanelBanners({
  busyLabel,
  notice,
  onCloseNotice,
  onNotice,
  error,
  onRetry,
  canUndo,
  undoOrigin,
  cwd,
  afterMutation,
}: {
  /** 远端操作执行中的操作名(获取/拉取/推送);null = 空闲。 */
  busyLabel: string | null;
  notice: string | null;
  onCloseNotice: () => void;
  onNotice: (msg: string | null) => void;
  error: string | null;
  /** 状态取数失败重试(afterMutation 全量刷新面)。 */
  onRetry: () => void;
  canUndo: boolean;
  undoOrigin: { cwd: string; branch: string } | null;
  cwd: string;
  afterMutation: () => void;
}) {
  return (
    <>
      {busyLabel && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-(--tmd-border) px-2 py-1 text-(--tmd-fg-subtle)">
          <Spinner /> {t("正在{op}…", { op: busyLabel })}
        </div>
      )}
      {notice && (
        <div className="flex shrink-0 items-start gap-1 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1 text-(--tmd-fg-muted)">
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button
            onClick={onCloseNotice}
            title={t("关闭")}
            className="rounded p-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            <Cross className="h-[0.75rem] w-[0.75rem]" aria-hidden />
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-(--tmd-border) bg-(--tmd-diff-removed)/8 px-2 py-1 text-(--tmd-diff-removed)"
        >
          <span className="min-w-0 flex-1 break-words">{gitErrorDisplay(error)}</span>
          <button
            type="button"
            className="shrink-0 rounded border border-(--tmd-diff-removed)/40 px-1.5 hover:bg-(--tmd-diff-removed)/10"
            onClick={onRetry}
          >
            {t("重试")}
          </button>
        </div>
      )}
      {canUndo && undoOrigin != null && (
        <SmartSwitchUndoBanner
          cwd={cwd}
          undoOrigin={undoOrigin}
          onNotice={onNotice}
          afterMutation={afterMutation}
        />
      )}
    </>
  );
}

export function GitPanelMain({
  cwd,
  repoCtx,
  repos,
  truncated,
  chipSeq,
  onSelect,
  scope,
  showScope,
  onScope,
  view,
  layout,
  files,
  totals,
  branches,
  log,
  statusError,
  branch,
  branchName,
  upstreamNull,
  detached,
  unborn,
  hasUpstream,
  aheadBehind,
  undoOrigin,
  afterMutation,
  prefill,
  remote,
}: GitPanelMainProps) {
  const { dialog, setDialog, remoteBusy, pushOutcome, notice, setNotice, runDialog } = remote;
  const canUndo = canUndoSmartSwitch(files, undoOrigin, cwd);
  /* 远端态镜像进 panelStore:顶栏视图下拉的刷新/获取/拉取/推送行只读消费。 */
  useEffect(() => {
    setGitRemoteMeta({
      detached,
      unborn,
      hasUpstream,
      ahead: aheadBehind?.ahead ?? 0,
      behind: aheadBehind?.behind ?? 0,
      busy: remoteBusy,
    });
  }, [detached, unborn, hasUpstream, aheadBehind, remoteBusy]);
  /* 远端操作执行中横幅的操作名(与对话框传入的 opLabel 同词)。 */
  const busyLabel =
    remoteBusy === "fetch"
      ? t("获取")
      : remoteBusy === "pull"
        ? t("拉取")
        : remoteBusy === "push"
          ? t("推送")
          : null;
  return (
    <div className="flex h-full flex-col text-xs">
      <GitToolbar cwd={repoCtx.selectedPath ?? undefined} />
      {/* RepoBar:多仓(现状)或本机多工作区(聚合入口)时渲染(spec 2026-10-08)。 */}
      {(repoCtx.showRepoBar || showScope) && (
        <RepoBar
          repos={repos}
          truncated={truncated}
          selectedPath={repoCtx.selectedPath!}
          chipSeq={chipSeq}
          onSelect={onSelect}
          scope={scope}
          onScope={onScope}
          showScope={showScope}
        />
      )}

      {/* 工作树常驻区(方案 B):多树仓才出现;「新建」走 worktree 弹窗(GitToolbar 持有)。 */}
      {repoCtx.selectedPath && (
        <WorktreeZone cwd={repoCtx.selectedPath} onCreate={() => requestWorktreeDialog()} />
      )}

      <PanelBanners
        busyLabel={busyLabel}
        notice={notice}
        onCloseNotice={() => setNotice(null)}
        onNotice={setNotice}
        error={statusError}
        onRetry={afterMutation}
        canUndo={canUndo}
        undoOrigin={undoOrigin}
        cwd={cwd}
        afterMutation={afterMutation}
      />

      {/* 视图保活(EditorCenter keepAlive 同款):三视图全挂载,非激活 display:none
          —— 切视图零卸载,diff 勾选 / 分支搜索与滚动 / 历史展开态跨切换存活。 */}
      <div className="min-h-0 flex-1">
        <div className={view === "diff" ? "h-full" : "hidden"} aria-hidden={view !== "diff"}>
          <DiffView
            cwd={cwd}
            layout={layout}
            files={files}
            totals={totals}
            prefill={prefill}
            onMutation={afterMutation}
            onError={setNotice}
          />
        </div>
        <div className={view === "branch" ? "h-full" : "hidden"} aria-hidden={view !== "branch"}>
          <BranchView
            cwd={cwd}
            data={branches.data}
            loading={branches.loading}
            currentName={branch}
            dirty={files.length > 0}
            onMutation={afterMutation}
          />
        </div>
        <div className={view === "history" ? "h-full" : "hidden"} aria-hidden={view !== "history"}>
          <HistoryView
            log={log}
            cwd={cwd}
            branch={branchName}
            upstream={upstreamNull}
            ahead={aheadBehind?.ahead ?? 0}
            behind={aheadBehind?.behind ?? 0}
          />
        </div>
      </div>
      <RemoteDialogGroup
        cwd={cwd}
        dialog={dialog}
        branch={branchName}
        repoName={repoDisplayName(repos.length, cwd)}
        remoteBusy={remoteBusy}
        pushOutcome={pushOutcome}
        onClose={() => setDialog(null)}
        onRun={runDialog}
      />
    </div>
  );
}
