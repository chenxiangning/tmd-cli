/**
 * GitPanel 主渲染 —— 自 GitPanel.tsx 拆出(no-high-complexity 降分支 +
 * 文件规模铁则):仓切换条/远端条/横幅簇/三视图/远端对话框的编排渲染;
 * 数据与派生展示值由 useGitPanelData 备好,此处零派生分支。
 */

import { t } from "@kernel/i18n";
import type { GitAheadBehind, GitFileStatus, GitRemoteRequest, GitRepoSummary, GitTotals } from "@kernel/ipc";
import { Cross } from "@phosphor-icons/react";
import type { GitLogState } from "./hooks/useGitLog";
import type { GitBranchesState } from "./hooks/useGitBranches";
import type { GitRepoContext } from "./repoContext";
import type { FileListLayout, GitViewMode } from "./panelStore";
import { gitErrorDisplay } from "./gitError";
import { GitRemoteBar, SmartSwitchUndoBanner } from "./views/GitPanelBars";
import { RepoBar } from "./views/RepoBar";
import { RemoteDialogGroup } from "./views/RemoteDialogGroup";
import { DiffView } from "./views/DiffView";
import { BranchView } from "./views/BranchView";
import { HistoryView } from "./views/HistoryView";

/** GitPanel 远端编排面 —— useGitPanelRemote 返回值的结构契约(此处只消费渲染所需)。 */
interface GitPanelRemoteState {
  dialog: GitRemoteRequest["op"] | null;
  setDialog: (op: GitRemoteRequest["op"] | null) => void;
  remoteBusy: "push" | "pull" | "fetch" | null;
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
  view: GitViewMode;
  layout: FileListLayout;
  files: GitFileStatus[];
  totals: GitTotals | null;
  branches: GitBranchesState;
  log: GitLogState;
  statusError: string | null;
  branch: string | undefined;
  branchName: string;
  upstream: string | null | undefined;
  upstreamNull: string | null;
  detached: boolean;
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

/** 多仓时的展示仓名:取 cwd 末段;单仓 undefined(对话框按需自解析)。 */
function repoDisplayName(repoCount: number, cwd: string): string | undefined {
  return repoCount >= 2 ? (cwd.split("/").filter(Boolean).pop() ?? undefined) : undefined;
}

/** 面板横幅簇:通知(可关闭)/ 状态错误 / 智能切换撤销横幅(降分支拆件)。 */
function PanelBanners({
  notice,
  onCloseNotice,
  onNotice,
  error,
  canUndo,
  undoOrigin,
  cwd,
  afterMutation,
}: {
  notice: string | null;
  onCloseNotice: () => void;
  onNotice: (msg: string | null) => void;
  error: string | null;
  canUndo: boolean;
  undoOrigin: { cwd: string; branch: string } | null;
  cwd: string;
  afterMutation: () => void;
}) {
  return (
    <>
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
        <div className="shrink-0 border-b border-(--tmd-border) bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {gitErrorDisplay(error)}
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
  view,
  layout,
  files,
  totals,
  branches,
  log,
  statusError,
  branch,
  branchName,
  upstream,
  upstreamNull,
  detached,
  hasUpstream,
  aheadBehind,
  undoOrigin,
  prefill,
  afterMutation,
  remote,
}: GitPanelMainProps) {
  const { dialog, setDialog, remoteBusy, notice, setNotice, runDialog } = remote;
  const canUndo = canUndoSmartSwitch(files, undoOrigin, cwd);
  return (
    <div className="flex h-full flex-col text-xs">
      {repoCtx.showRepoBar && (
        <RepoBar
          repos={repos}
          truncated={truncated}
          selectedPath={repoCtx.selectedPath!}
          chipSeq={chipSeq}
          onSelect={onSelect}
        />
      )}
      <GitRemoteBar
        branch={branch}
        upstream={upstream}
        remoteBusy={remoteBusy}
        detached={detached}
        aheadBehind={aheadBehind}
        hasUpstream={hasUpstream}
        onOpenDialog={setDialog}
      />

      <PanelBanners
        notice={notice}
        onCloseNotice={() => setNotice(null)}
        onNotice={setNotice}
        error={statusError}
        canUndo={canUndo}
        undoOrigin={undoOrigin}
        cwd={cwd}
        afterMutation={afterMutation}
      />

      <div className="min-h-0 flex-1">
        {view === "diff" && (
          <DiffView
            cwd={cwd}
            layout={layout}
            files={files}
            totals={totals}
            prefill={prefill}
            onMutation={afterMutation}
          />
        )}
        {view === "branch" && (
          <BranchView
            cwd={cwd}
            data={branches.data}
            loading={branches.loading}
            currentName={branch}
            dirty={files.length > 0}
            onMutation={afterMutation}
          />
        )}
        {view === "history" && (
          <HistoryView
            log={log}
            cwd={cwd}
            branch={branchName}
            upstream={upstreamNull}
            ahead={aheadBehind?.ahead ?? 0}
            behind={aheadBehind?.behind ?? 0}
          />
        )}
      </div>
      <RemoteDialogGroup
        cwd={cwd}
        dialog={dialog}
        branch={branchName}
        repoName={repoDisplayName(repos.length, cwd)}
        remoteBusy={remoteBusy}
        onClose={() => setDialog(null)}
        onRun={runDialog}
      />
    </div>
  );
}
