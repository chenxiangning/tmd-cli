import { GitBranch, GitCommitHorizontal } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { setFilePanelMode } from "@kernel/filePanel";
import { GitPanel } from "./GitPanel";
import { GitToolbar } from "./GitToolbar";
import { CommitDiffTabContent } from "./CommitDiffTab";
import { DiffTabContent } from "./DiffTabContent";
import { COMMIT_TAB_KIND } from "./commitTab";
import { DIFF_TAB_KIND } from "./diffTab";

/** Git 插件入口:单视图三段面板(差异/分支/历史)+ 提交 diff 中央 tab。
 *  契约见 openspec/changes/git-right-panel/ 与
 *  docs/superpowers/specs/2026-09-04-git-history-graph-design.md;
 *  commit 执行权仅在 DiffView 提交按钮。 */

export const gitPlugin: Plugin = {
  id: "git",
  meta: { name: "Git", abbr: "GT", desc: "Git 状态与面板集成", icon: GitBranch, iconColor: "#F05032", category: "feature" },
  activate(ctx) {
    ctx.registerFilePanel({
      id: "git",
      label: "Git",
      icon: GitBranch,
      component: GitPanel,
      toolbar: GitToolbar,
      showFileSubbar: false, // git 面板自带聚合行(分支 → upstream · fetch/pull/push)
    });
    // 侧栏「Git Graph」快捷动作:一键把右栏切到 git 面板(差异/分支/历史三段)。
    ctx.registerSidebarAction({
      id: "git-graph",
      label: "Git Graph",
      icon: GitCommitHorizontal,
      order: 20,
      onSelect: () => setFilePanelMode("git"),
    });
    // 提交 diff tab + 工作区 diff tab:右栏点文件 → 编辑器区打开(同 checkpoints 批审阅单模式)
    ctx.registerTabContent({ kind: COMMIT_TAB_KIND, component: CommitDiffTabContent });
    ctx.registerTabContent({ kind: DIFF_TAB_KIND, component: DiffTabContent });
  },
};
