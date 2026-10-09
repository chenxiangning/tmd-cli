/**
 * GitPanel —— 右栏 Git 单视图面板(布局契约:proposal §1.3 / design §8)。
 * 数据编排拆至 useGitPanelData.ts,主渲染拆至 GitPanelMain.tsx(横幅簇随迁);
 * 本文件只留多仓语境解析与空态守卫(no-high-complexity 降分支 + 文件规模铁则)。
 */

import { t } from "@kernel/i18n";
import { GitBranch } from "@phosphor-icons/react";
import { Empty } from "@kernel/Empty";
import { useGitPanelContext } from "./hooks/useGitPanelContext";
import { useGitPanelData } from "./useGitPanelData";
import { useGitPanelRemote } from "./useGitPanelRemote";
import { GitPanelMain } from "./GitPanelMain";
import { AggregateReposView } from "./views/AggregateReposView";
import { RepoBar } from "./views/RepoBar";
import { useAggregateScope } from "./useAggregateRepos";
import type { GitRepoSummary } from "@kernel/ipc";
import { RepoGuide } from "./views/RepoGuide";

/** 「全部」态整壳:聚合视图(顶行批量条;RepoBar 经 prop 渲染在批量条之下,chips 仍是当前工作区仓,点 chip = 选仓回本仓)。 */
function GitPanelAggregate({
  repos,
  truncated,
  selectedPath,
  chipSeq,
  scope,
  showScope,
  onScope,
  onSelectRepo,
  onJump,
  afterBatch,
}: {
  repos: GitRepoSummary[];
  truncated: boolean;
  selectedPath: string;
  chipSeq: number;
  scope: "repo" | "all";
  showScope: boolean;
  onScope: (scope: "repo" | "all") => void;
  onSelectRepo: (path: string) => void;
  onJump: (wsId: string, path: string) => void;
  afterBatch: () => void;
}) {
  return (
    <div className="flex h-full flex-col text-xs">
      <AggregateReposView
        onJump={onJump}
        afterBatch={afterBatch}
        repoBar={
          <RepoBar
            repos={repos}
            truncated={truncated}
            selectedPath={selectedPath}
            chipSeq={chipSeq}
            onSelect={(p) => {
              onSelectRepo(p);
              onScope("repo");
            }}
            scope={scope}
            onScope={onScope}
            showScope={showScope}
          />
        }
      />
    </div>
  );
}

export function GitPanel() {
  const { root, isRemote, repos, truncated, refreshRepos, repoCtx, cwd, selectRepo } = useGitPanelContext();

  const data = useGitPanelData(isRemote ? null : cwd, refreshRepos);
  const remote = useGitPanelRemote(isRemote ? null : cwd, data.afterMutation);

  /* 聚合模式(spec 2026-10-08-git-batch-ops-design):范围态组件内会话期有效;
   * 段控入口 = 本机工作区 ≥2 或当前工作区多仓(单仓单工作区用户零新 UI,回归红线)。
   * 聚合分支抽 GitPanelAggregate(文件头:本文件只留语境解析与空态守卫,降复杂度)。 */
  const { scope, setScope, showScope, jumpToRepo } = useAggregateScope(repos);

  if (scope === "all" && showScope) {
    return (
      <GitPanelAggregate
        repos={repos}
        truncated={truncated}
        selectedPath={repoCtx.selectedPath ?? root ?? ""}
        chipSeq={data.chipSeq}
        scope={scope}
        showScope={showScope}
        onScope={setScope}
        onSelectRepo={selectRepo}
        onJump={jumpToRepo}
        afterBatch={data.afterMutation}
      />
    );
  }

  if (isRemote) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-(--tmd-fg-faint)">
        {t("远程工作区暂不支持 Git 面板")}
      </div>
    );
  }

  if (!cwd || data.status.notARepo) {
    if (repoCtx.mode === "guide") {
      return <RepoGuide root={root!} repos={repos} truncated={truncated} onSelect={selectRepo} />;
    }
    return (
      <div className="flex h-full items-center justify-center px-4">
        <Empty icon={<GitBranch />}>{t("当前目录不是 Git 仓库")}</Empty>
      </div>
    );
  }

  return (
    <GitPanelMain
      cwd={cwd}
      repoCtx={repoCtx}
      repos={repos}
      truncated={truncated}
      chipSeq={data.chipSeq}
      onSelect={selectRepo}
      scope={scope}
      showScope={showScope}
      onScope={setScope}
      view={data.view}
      layout={data.layout}
      files={data.files}
      totals={data.totals.data}
      branches={data.branches}
      log={data.log}
      statusError={data.status.error}
      branch={data.branch}
      branchName={data.branchName}
      upstreamNull={data.upstreamNull}
      detached={data.detached}
      unborn={data.unborn}
      hasUpstream={data.hasUpstream}
      aheadBehind={data.aheadBehind}
      undoOrigin={data.undoOrigin}
      prefill={data.prefill}
      afterMutation={data.afterMutation}
      remote={remote}
    />
  );
}
