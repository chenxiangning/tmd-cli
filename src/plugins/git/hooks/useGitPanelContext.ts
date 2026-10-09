/**
 * useGitPanelContext —— GitPanel 语境解析头(GitPanel 复杂度治理:no-high-complexity
 * 抽离):活动工作区 → root → 远程降级判定 → 多仓分档(repos/选中仓/cwd)。
 * 单仓档输出 selectedPath = root、零新 UI,与现状逐项一致(回归红线)。
 */

import { useCallback, useEffect } from "react";
import { setGitViewRepo } from "@kernel/gitViewRepo";
import { useWorkspaces } from "@kernel/workspace";
import { useGitRepos } from "./useGitRepos";
import { resolveRepoContext } from "../repoContext";
import { getSelectedRepo, setSelectedRepo } from "../panelStore";

export function useGitPanelContext() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root ?? null;
  /* 远程工作区(SSH 远程 WSL 来源,wsl.hostId 非空)显式降级:git2 内核原语只认
   * 本机路径,与其让底层扫描报错,不如一句横幅说清;本机 UNC(hostId null)不动。
   * 降级必须同时断数据面:钩子收 null(短路)而非远端路径 —— 否则横幅可见期
   * useGitStatus 5s / useGitRepos 60s 对远端路径持续必败空转(2026-10-04 评审 F1)。 */
  const isRemote = Boolean(active?.wsl?.hostId);

  /* 多仓分档(spec 2026-09-07-git-multi-repo-design §3):cwd 换源 = 选中仓 ?? root。 */
  const { repos, truncated, refresh: refreshRepos } = useGitRepos(isRemote ? null : root);
  const remembered = active ? getSelectedRepo(active.id) : null;
  const repoCtx = resolveRepoContext(root, repos, remembered);
  const cwd = repoCtx.selectedPath ?? root;
  const selectRepo = useCallback(
    (path: string) => {
      if (active) setSelectedRepo(active.id, path);
    },
    [active],
  );
  /* 顶栏分支 label 数据源(跨层契约 @kernel/gitViewRepo):解析后的选中仓
   * 同步给 shell;guide 档未点选 selectedPath=null,label 回退工作区根。 */
  const wsId = active?.id ?? null;
  const selectedPath = repoCtx.selectedPath;
  useEffect(() => {
    if (wsId) setGitViewRepo({ workspaceId: wsId, cwd: selectedPath });
  }, [wsId, selectedPath]);

  return { root, isRemote, repos, truncated, refreshRepos, repoCtx, cwd, selectRepo };
}
