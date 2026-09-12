/**
 * GitPanel —— 右栏 Git 单视图面板(布局契约:proposal §1.3 / design §8)。
 * 数据编排拆至 useGitPanelData.ts,主渲染拆至 GitPanelMain.tsx(横幅簇随迁);
 * 本文件只留多仓语境解析与空态守卫(no-high-complexity 降分支 + 文件规模铁则)。
 */

import { useCallback } from "react";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { useGitRepos } from "./hooks/useGitRepos";
import { resolveRepoContext } from "./repoContext";
import { getSelectedRepo, setSelectedRepo } from "./panelStore";
import { useGitPanelData } from "./useGitPanelData";
import { useGitPanelRemote } from "./useGitPanelRemote";
import { GitPanelMain } from "./GitPanelMain";
import { RepoGuide } from "./views/RepoGuide";

export function GitPanel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root ?? null;

  /* 多仓分档(spec 2026-09-07-git-multi-repo-design §3):cwd 换源 = 选中仓 ?? root。
   * 单仓档输出 selectedPath = root、零新 UI,与现状逐项一致(回归红线)。 */
  const { repos, truncated, refresh: refreshRepos } = useGitRepos(root);
  const remembered = active ? getSelectedRepo(active.id) : null;
  const repoCtx = resolveRepoContext(root, repos, remembered);
  const cwd = repoCtx.selectedPath ?? root;
  const selectRepo = useCallback(
    (path: string) => {
      if (active) setSelectedRepo(active.id, path);
    },
    [active],
  );

  const data = useGitPanelData(cwd, refreshRepos);
  const remote = useGitPanelRemote(cwd, data.afterMutation);

  if (!cwd || data.status.notARepo) {
    if (repoCtx.mode === "guide") {
      return <RepoGuide root={root!} repos={repos} truncated={truncated} onSelect={selectRepo} />;
    }
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-(--tmd-fg-faint)">
        {t("当前目录不是 Git 仓库")}
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
      view={data.view}
      layout={data.layout}
      files={data.files}
      totals={data.totals.data}
      branches={data.branches}
      log={data.log}
      statusError={data.status.error}
      branch={data.branch}
      branchName={data.branchName}
      upstream={data.upstream}
      upstreamNull={data.upstreamNull}
      detached={data.detached}
      hasUpstream={data.hasUpstream}
      aheadBehind={data.aheadBehind}
      undoOrigin={data.undoOrigin}
      prefill={data.prefill}
      afterMutation={data.afterMutation}
      remote={remote}
    />
  );
}
