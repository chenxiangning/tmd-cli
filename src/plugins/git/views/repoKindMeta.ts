/**
 * 仓 kind 元数据 —— kind 小图标与类型标签(自 RepoBar.tsx 拆出,
 * only-export-components):RepoBar 与 RepoGuide 共用。
 */

import { Cube, GitBranch, TreeStructure, type Icon } from "@phosphor-icons/react";
import type { GitRepoSummary } from "@kernel/ipc";

export const KIND_META: Record<GitRepoSummary["kind"], { icon: Icon; label: string | null }> = {
  repo: { icon: GitBranch, label: null },
  submodule: { icon: Cube, label: "子模块" },
  worktree: { icon: TreeStructure, label: "工作树" },
};
